# AI-Orchestrator Diagnostics

Repository dedicato ai log tecnici filtrati di AI-Orchestrator.

Nome previsto: `Ai-orchestrator-diagnostics`.

I log saranno allegati alla release `diagnostics-v1`, non salvati nei commit Git. `latest.txt` contiene l'ultima porzione facile da copiare; `diag-*.txt` sono i file di archivio (massimo 1 MiB ciascuno). Rotazione a 20 MiB per gli allegati gestiti dall'app, con priorità ai crash. Non caricare log grezzi: possono contenere conversazioni, token, percorsi e informazioni personali.

Origini: Runtime Diagnostics e log persistente Android, recuperato al successivo avvio dopo un crash. L'app necessita di un token fine-grained limitato a questo repository con Contents read/write. Il token va inserito nell'app, mai nei file o in chat.

L'invio deve essere esplicitamente abilitato nelle impostazioni diagnostiche dell'app. L'app non garantisce upload mentre Android sospende o termina il processo. I dati rimangono nella coda locale fino al nuovo tentativo, entro il limite di conservazione.
