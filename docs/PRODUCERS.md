# Shared diagnostics producers

`Ai-orchestrator-diagnostics` is the shared, public diagnostics sink for AI Orchestrator producers. Diagnostic payloads are stored in GitHub Release bodies and Release assets; the repository tree contains only contracts and documentation.

## Compatibility rule

The Android app producer remains unchanged and is the compatibility baseline:

- producer: `app`
- release tag: `diagnostics-v1-<installation-id>`
- release name: `Diagnostica <device-name>`
- archive assets: `diag-<sha256>.txt` and `diag-crash-<sha256>.txt`
- convenience asset: `latest.txt`
- maximum archive chunk: 1 MiB
- retention budget: 20 MiB per installation/release, with crash priority

Do not rename or migrate these assets globally. Existing releases are historical evidence.

## New producer namespaces

Library and Researcher MUST use their own releases and assets. They MUST NOT write to an app installation release.

| Producer | Release tag | Archive assets | Latest asset |
| --- | --- | --- | --- |
| app | `diagnostics-v1-<installation-id>` | legacy `diag-*.txt`, `diag-crash-*.txt` | `latest.txt` |
| library | `diagnostics-library-v1-<instance-id>` | `library-diag-<sha256>.jsonl` | `library-latest.jsonl` |
| researcher | `diagnostics-researcher-v1-<instance-id>` | `researcher-diag-<sha256>.jsonl` | `researcher-latest.jsonl` |

`instance-id` MUST be stable for the producer installation/service instance and MUST NOT contain credentials or personal data.

## Event contract

New producers emit UTF-8 JSON Lines. Each line MUST validate against `schemas/diagnostic-event-v2.schema.json` and contain:

- `schema`: fixed value `ai-orchestrator.diagnostics.event.v2`
- `producer`: `library` or `researcher`
- `producer_version`: immutable application version or commit SHA
- `platform`: execution platform such as `github-actions`, `linux`, `windows`, `android`
- `instance`: stable producer instance identifier
- `session` or `run`: correlation identifier for the current execution
- `timestamp`: ISO-8601/RFC3339 timestamp with `Z` or an explicit UTC offset
- `event`: stable machine-readable event name
- `severity`: `debug`, `info`, `warning`, `error`, or `critical`
- optional `correlation_id` and `fields` containing filtered technical metadata only

Raw conversations, prompts, source payloads, API tokens, authorization headers, secrets, passwords, private keys, cookies and unrestricted filesystem paths MUST NOT be published.

## Publishing algorithm

Each producer owns only its namespace.

1. Filter/redact before persistence.
2. Serialize deterministically and compute SHA-256 over the exact archive bytes.
3. Resolve or create only the producer release tag for the current instance.
4. List all release assets with pagination (`per_page=100&page=N`).
5. Treat an existing archive with the expected name, size and uploaded state as an idempotent success.
6. Upload a missing archive, then update only that producer's latest convenience asset.
7. Update the release body with a bounded, deduplicated readable summary.
8. Acknowledge/delete the local queue item only after all required remote writes succeed.
9. Retry failures with bounded exponential backoff.
10. Rotate only assets matching the current producer's own prefix and only inside its own release. Never perform repository-wide cleanup.

For the app, keep the existing 1 MiB/archive and 20 MiB/installation limits. Library and Researcher should default to the same limits unless their implementation documents a stricter producer-specific budget.

## GitHub endpoints

For repository `pilialvu75-hue/Ai-orchestrator-diagnostics`:

- list releases: `GET /repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases?per_page=100&page=<n>`
- release by tag: `GET /repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases/tags/<tag>`
- create release: `POST /repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases`
- list release assets: `GET /repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases/<release-id>/assets?per_page=100&page=<n>`
- upload asset: `POST https://uploads.github.com/repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases/<release-id>/assets?name=<asset-name>`
- delete an owned asset: `DELETE /repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases/assets/<asset-id>`
- update release summary: `PATCH /repos/pilialvu75-hue/Ai-orchestrator-diagnostics/releases/<release-id>`

A producer credential should be a fine-grained token scoped only to this repository with Contents read/write, stored in the producer's secure secret store. Chat connector credentials and producer credentials are separate.

## Reading and incident analysis

Do not infer service emptiness from the `main` branch. Enumerate releases and assets. Release bodies contain recent cumulative filtered events; archive assets contain the longer rotated history.

Always distinguish producer/instance, platform, build or commit, capture session/run, event timestamp and event origin. A build that recovered Android process-exit history is the collection context, not necessarily the build on which the historical process exit occurred. Deduplicate repeated records by their original event payload and correlation identity where available.
