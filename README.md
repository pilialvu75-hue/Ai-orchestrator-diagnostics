# AI-Orchestrator Diagnostics

Repository pubblico dedicato ai log tecnici filtrati dei componenti AI Orchestrator.

**I dati diagnostici non sono nel solo branch `main`.** La cronologia operativa viene pubblicata soprattutto nei body delle GitHub Release e nei relativi allegati. Per analizzare un problema bisogna quindi enumerare le release e i loro assets, non limitarsi al contenuto Git del repository, a `/releases/latest` o a un singolo `latest.txt`.

## App Android — formato esistente e compatibile

L'app usa una release per installazione:

- tag: `diagnostics-v1-<installation-id>`
- nome release: `Diagnostica <device-name>`
- `latest.txt`: ultima porzione facilmente leggibile
- `diag-<sha256>.txt`: archivio tecnico filtrato
- `diag-crash-<sha256>.txt`: archivio con evidenza di crash/process-exit
- massimo 1 MiB per file di archivio
- rotazione fino a 20 MiB per installazione/release, con priorità ai crash

Origini attuali: Runtime Diagnostics e log persistente Android recuperato al successivo avvio. Il build indicato nel contesto è il build che ha raccolto/pubblicato l'evidenza e non dimostra che un process exit storico sia avvenuto su quello stesso build.

L'invio dell'app è opt-in. Il token fine-grained del produttore deve essere limitato a questo repository con Contents read/write e conservato nello storage sicuro dell'app; non va inserito nei file, nei log o in chat.

## Servizio condiviso

Il repository accoglie anche diagnostica di **Module Library** e **Researcher**, senza condividere release o nomi di asset con l'app:

- Library: `diagnostics-library-v1-<instance-id>`
- Researcher: `diagnostics-researcher-v1-<instance-id>`

I nuovi produttori usano eventi JSON Lines conformi a `schemas/diagnostic-event-v2.schema.json`. Il contratto completo di namespace, endpoint, privacy, idempotenza, retry e rotazione è in `docs/PRODUCERS.md`.

Ogni evento v2 identifica almeno produttore, versione/commit, piattaforma, istanza, sessione o run, timestamp con fuso orario, evento e gravità. Sono vietati credenziali, conversazioni, prompt, payload grezzi, authorization header, cookie e segreti.

## Regole di conservazione e sicurezza

Ogni produttore può ruotare **soltanto i propri asset nella propria release**. Non è consentita una pulizia globale del repository o delle release degli altri produttori. Gli invii devono essere idempotenti e la coda locale va riconosciuta come consegnata soltanto dopo aver verificato la scrittura remota richiesta.

I log pubblici sono intenzionalmente filtrati. L'assenza di un dettaglio nei log non dimostra l'assenza del problema originale.

## Lettura via GitHub API

Endpoint principale per la cronologia:

`GET /repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases?per_page=100&page=<n>`

Per ogni release vanno letti sia il campo `body` sia gli assets paginati. Usare i `browser_download_url` restituiti dall'API per gli allegati; non costruire nomi o percorsi per supposizione.

Vedi `docs/PRODUCERS.md` per gli endpoint di pubblicazione realmente previsti e i namespace supportati.
