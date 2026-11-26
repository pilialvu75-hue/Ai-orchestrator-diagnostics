// Standalone AIVEXUS diagnostics pilot. No Beta Access or client GitHub token.
const REPO = "pilialvu75-hue/Ai-orchestrator-diagnostics";
const API = "https://api.github.com/repos/" + REPO;
const UPLOAD = "https://uploads.github.com/repos/" + REPO;
const COMPONENTS = new Set(["application","updater","storage","notifications","runtime"]);
const EVENTS = new Set(["started","completed","failed","timeout","crash","recovered"]);
const MAX_BYTES = 32768;
const MAX_DAILY = 20;
const MAX_RELEASE = 200;
const enc = new TextEncoder();
const json = (body,status=200) => Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const fail = (status,code) => json({error:code},status);

async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==="string"?enc.encode(value):value)),b=>b.toString(16).padStart(2,"0")).join("");
}
async function auth(req,env) {
  if (!/^[a-f0-9]{64}$/.test(env.RV_PILOT_TOKEN || "")) return false;
  const supplied = req.headers.get("Authorization") || "";
  if (!/^Bearer [a-f0-9]{64}$/.test(supplied)) return false;
  const [a,b]=await Promise.all([hash(supplied.slice(7)),hash(env.RV_PILOT_TOKEN)]);
  let diff=0; for(let i=0;i<64;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function readBounded(req) {
  if (!req.body) throw Error("body");
  const reader=req.body.getReader(), chunks=[];
  let length=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if(done) break;
      length+=value.byteLength;
      if(length>MAX_BYTES) { await reader.cancel(); throw Error("size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length);
  let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
export function normalize(input,now=Date.now()) {
  if (!input || typeof input!=="object" || Array.isArray(input) ||
      Object.keys(input).length!==2 || input.schema!==1 ||
      !Array.isArray(input.events) || input.events.length<1 || input.events.length>100) throw Error("schema");
  return {schema:1,events:input.events.map(e=>{
    if(!e || typeof e!=="object" || Array.isArray(e) ||
      Object.keys(e).some(k=>!["time","component","event","elapsed_ms"].includes(k)) ||
      typeof e.time!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(e.time) ||
      !COMPONENTS.has(e.component) || !EVENTS.has(e.event)) throw Error("event");
    const timestamp=Date.parse(e.time);
    if(!Number.isFinite(timestamp) || new Date(timestamp).toISOString()!==e.time ||
      timestamp>now+5*60_000 || timestamp<now-7*86400_000) throw Error("timestamp");
    if("elapsed_ms" in e && (!Number.isSafeInteger(e.elapsed_ms) || e.elapsed_ms<0 || e.elapsed_ms>86400000)) throw Error("elapsed");
    return {time:e.time,component:e.component,event:e.event,...("elapsed_ms" in e?{elapsed_ms:e.elapsed_ms}:{})};
  })};
}
// A single atomic D1 insert reserves a quota slot. Only hashes and UTC day
// are retained; repeat attempts on the same report never consume another slot.
async function reserve(db,tag,digest,day) {
  await db.prepare("INSERT INTO relay_batches(tag,digest,day) SELECT ?,?,? WHERE (SELECT count(*) FROM relay_batches WHERE tag=? AND day=?) < ? AND (SELECT count(*) FROM relay_batches WHERE tag=?) < ? ON CONFLICT(tag,digest) DO NOTHING")
    .bind(tag,digest,day,tag,day,MAX_DAILY,tag,MAX_RELEASE).run();
  return !!(await db.prepare("SELECT digest FROM relay_batches WHERE tag=? AND digest=?").bind(tag,digest).first());
}
function ghHeaders(env,extra={}) {
  return {Authorization:"Bearer "+env.DIAGNOSTICS_GITHUB_TOKEN,Accept:"application/vnd.github+json","User-Agent":"AIVEXUS-Diagnostics-Relay/1.0", "X-GitHub-Api-Version":"2022-11-28",...extra};
}
async function github(env,fetcher,url,method="GET",body,contentType="application/json") {
  const r=await fetcher(url,{method,headers:ghHeaders(env,body===undefined?{}:{"Content-Type":contentType}),body,redirect:"error",signal:AbortSignal.timeout(10000)});
  if(r.status===404) return null;
  if(!r.ok) throw Error("github");
  return r.json();
}
async function resolveRelease(env,fetcher,tag) {
  const url=API+"/releases/tags/"+tag;
  let release=await github(env,fetcher,url);
  if(!release) {
    try {
      release=await github(env,fetcher,API+"/releases","POST",JSON.stringify({
        tag_name:tag,target_commitish:"main",name:"AIVEXUS RendezVous technical diagnostics",body:"Filtered, consented technical events only. Archive assets are content addressed.",draft:false,prerelease:false
      }));
    } catch { release=await github(env,fetcher,url); }
  }
  if(!release || release.tag_name!==tag || !Number.isSafeInteger(release.id) || release.draft!==false) throw Error("release");
  return release.id;
}
async function findAsset(env,fetcher,id,name) {
  for(let page=1;page<=3;page++){
    const assets=await github(env,fetcher,API+"/releases/"+id+"/assets?per_page=100&page="+page);
    if(!Array.isArray(assets)) throw Error("assets");
    const asset=assets.find(a=>a.name===name);
    if(asset) return asset;
    if(assets.length<100) return null;
  }
  throw Error("asset_limit");
}
function verified(asset,name,size,digest) {
  return asset && asset.name===name && asset.state==="uploaded" &&
    asset.size===size && asset.digest==="sha256:"+digest;
}
async function publish(env,fetcher,tag,bytes,digest) {
  const id=await resolveRelease(env,fetcher,tag);
  const name="rendezvous-diag-"+digest+".json";
  let asset=await findAsset(env,fetcher,id,name);
  if(!asset) {
    try { await github(env,fetcher,UPLOAD+"/releases/"+id+"/assets?name="+name,"POST",bytes,"application/json"); }
    catch { /* Duplicate concurrent upload or ambiguous failure: verify below. */ }
    asset=await findAsset(env,fetcher,id,name);
  }
  // No acknowledgement on name/size alone. Never overwrite/delete any asset.
  if(!verified(asset,name,bytes.byteLength,digest)) throw Error("unverified");
  return {release:tag,asset:name,sha256:digest};
}

export async function handle(request,env,fetcher=fetch,now=Date.now()) {
  const url=new URL(request.url);
  const match=/^\/v1\/rendezvous\/(\d+\.\d+\.\d+)\/report$/.exec(url.pathname);
  if(request.method!=="POST" || !match || url.search || match[1]!==env.RV_PILOT_VERSION) return fail(404,"not_found");
  if(!env.DB || !env.DIAGNOSTICS_GITHUB_TOKEN || !/^[a-f0-9]{64}$/.test(env.RV_PILOT_TOKEN||"")) return fail(503,"unconfigured");
  if(!await auth(request,env)) return fail(401,"unauthorized");
  if(request.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json") return fail(415,"content_type");
  if(Number(request.headers.get("Content-Length"))>MAX_BYTES) return fail(413,"too_large");
  let report;
  try { report=normalize(await readBounded(request),now); }
  catch { return fail(400,"invalid_report"); }
  const tag="diagnostics-rendezvous-v1-"+match[1];
  // Version and producer are server-bound, never arbitrary client fields.
  const bytes=enc.encode(JSON.stringify({schema:"aivexus.diagnostics.report.v1",producer:"rendezvous",producer_version:match[1],platform:"android",events:report.events}));
  const digest=await hash(bytes);
  try {
    if(!await reserve(env.DB,tag,digest,new Date(now).toISOString().slice(0,10))) return fail(429,"quota");
    const receipt=await publish(env,fetcher,tag,bytes,digest);
    return json({status:"verified",...receipt});
  } catch { return fail(503,"delivery_unverified"); }
}
export default {fetch(request,env) { return handle(request,env); }};
