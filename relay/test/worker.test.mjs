import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {handle,normalize} from "../src/worker.mjs";
const now=Date.parse("2026-11-26T14:30:00Z");
const token="a".repeat(64);
const endpoint="https://receiver.example.test/v1/rendezvous/0.2.12/report";
const event={time:"2026-11-26T14:29:00.000Z",component:"runtime",event:"failed",elapsed_ms:42};
const report={schema:1,events:[event]};
function fixture({wrongDigest=false,missingDigest=false}={}){
  const rows=new Map(),assets=[],requests=[];
  let release=null;
  const DB={prepare(sql){return {bind(...args){return {
    async run(){
      const [tag,digest,day,,,limit,,total]=args;
      const all=[...rows.values()].filter(r=>r.tag===tag);
      if(all.filter(r=>r.day===day).length<limit && all.length<total) rows.set(tag+digest,{tag,digest,day});
    },
    async first(){return rows.get(args[0]+args[1])||null;}
  };}};}};
  const env={DB,RV_PILOT_TOKEN:token,RV_PILOT_VERSION:"0.2.12",DIAGNOSTICS_GITHUB_TOKEN:"server-only-test-secret"};
  const fetcher=async(url,options)=>{
    requests.push({url,method:options.method});
    assert.equal(options.headers.Authorization,"Bearer server-only-test-secret");
    assert.equal(options.redirect,"error");
    if(url.includes("/releases/tags/")) return release?Response.json(release):new Response("",{status:404});
    if(url.endsWith("/releases") && options.method==="POST"){
      const body=JSON.parse(options.body);
      release={tag_name:body.tag_name,id:123,draft:false};
      return Response.json(release,{status:201});
    }
    if(url.includes("/assets?per_page=")) return Response.json(assets);
    if(url.startsWith("https://uploads.github.com/")){
      const name=new URL(url).searchParams.get("name");
      const bytes=options.body;
      const digest=createHash("sha256").update(bytes).digest("hex");
      const asset={name,state:"uploaded",size:bytes.length,...(!missingDigest?{digest:"sha256:"+(wrongDigest?"0".repeat(64):digest)}:{})};
      assets.push(asset);
      return Response.json(asset,{status:201});
    }
    throw Error("Unexpected request");
  };
  function send(body=report,credential=token,url=endpoint){
    return handle(new Request(url,{method:"POST",headers:{Authorization:"Bearer "+credential,"Content-Type":"application/json"},body:JSON.stringify(body)}),env,fetcher,now);
  }
  return {send,requests,assets,rows,env};
}
test("strict projection accepts technical fields only",()=>{
  assert.deepEqual(normalize(report,now),report);
  for(const body of [
    {...report,customer:"private"},
    {schema:1,events:[{...event,path:"/secret"}]},
    {schema:1,events:[{...event,event:"free text"}]},
    {schema:1,events:[{...event,time:"2026-11-26T14:29:55.000Z"}]},
    {schema:1,events:[{...event,elapsed_ms:-1}]},
    {schema:1,events:[{...event,time:"2026-01-01T00:00:00.000Z"}]},
  ]) assert.throws(()=>normalize(body,now));
});
test("reject unauthorized, wrong route and raw customer data before network",async()=>{
  const f=fixture();
  assert.equal((await f.send(report,"b".repeat(64))).status,401);
  assert.equal((await f.send(report,token,endpoint.replace("0.2.12","0.2.11"))).status,404);
  assert.equal((await f.send({schema:1,events:[{...event,appointment:"private"}]})).status,400);
  assert.equal(f.requests.length,0);
  assert.equal(f.rows.size,0);
});
test("verified receipt, duplicate request does not upload twice",async()=>{
  const f=fixture();
  const first=await f.send();
  assert.equal(first.status,200);
  const a=await first.json();
  assert.equal(a.status,"verified");
  assert.equal(a.release,"diagnostics-rendezvous-v1-0.2.12");
  assert.equal(a.asset,"rendezvous-diag-"+a.sha256+".json");
  assert.deepEqual(await (await f.send()).json(),a);
  assert.equal(f.assets.length,1);
  assert.equal(f.rows.size,1);
  assert.equal(f.requests.filter(r=>r.url.startsWith("https://uploads.github.com")).length,1);
});
test("missing or wrong remote digest cannot acknowledge delivery",async()=>{
  for(const options of [{wrongDigest:true},{missingDigest:true}]){
    const f=fixture(options);
    const response=await f.send();
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:"delivery_unverified"});
  }
});
test("daily unique quota excludes retries",async()=>{
  const f=fixture();
  for(let i=0;i<20;i++) assert.equal((await f.send({schema:1,events:[{...event,elapsed_ms:i}]})).status,200);
  assert.equal((await f.send({schema:1,events:[{...event,elapsed_ms:20}]})).status,429);
  assert.equal((await f.send({schema:1,events:[{...event,elapsed_ms:0}]})).status,200);
  assert.equal(f.assets.length,20);
});
test("unconfigured receiver cannot transmit",async()=>{
  const f=fixture();
  delete f.env.DIAGNOSTICS_GITHUB_TOKEN;
  assert.equal((await f.send()).status,503);
  assert.equal(f.requests.length,0);
});
