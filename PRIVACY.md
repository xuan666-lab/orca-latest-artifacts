# Privacy and permissions

Latest Artifacts processes data locally. There is no telemetry, external model call, or upload endpoint.

## Data read

- The selected Orca profile's workspace/tab metadata and agent session journal.
- Local terminal identity records and, when attribution requires it, the selected Claude session's transcript.
- Artifact metadata and file bytes for thumbnails, version checks and explicit file opening.
- Explicitly selected directories when directory discovery is used.

## Data stored

Derived artifact paths, signatures/hashes, session attribution metadata, scan cursors, user-hidden artifact choices and thumbnail images are stored in the plugin's local storage. Raw conversation text is not intentionally persisted in the evidence cache. Helpers for explicit registrations and tracked terminals keep scoped local metadata under the user's local data directory.

Trusted-worker code has the filesystem access of the local user; the manifest capability list is not a filesystem sandbox. Review the source before approving a plugin with this execution mode.

## Preview isolation

HTML thumbnail rendering uses a loopback server restricted to an allowlisted file scope and an unguessable token. A restrictive Content Security Policy blocks scripts and external requests. Preview servers and temporary browser profiles are closed after use. Opening an artifact in Orca is an explicit user action and follows Orca's normal browser/file behavior.

## Permission purpose

| Capability | Purpose |
| --- | --- |
| storage:own | Local settings, indexes and thumbnail cache |
| workspace:read | Workspace context and focus events |
| agent:read | Agent metadata/events where available |
| terminal:read | Read-only terminal discovery and verification |

No terminal-send permission is requested. The plugin does not submit messages to agents or modify source artifacts.

## Removal and reporting

Disabling the plugin stops its workers and scans. Local cache retention/removal follows Orca's plugin storage behavior. Do not attach real databases or transcripts to public issues; provide a synthetic reproduction or a redacted error message.
