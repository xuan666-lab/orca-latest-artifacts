# Compatibility

## Tested release target

- macOS; validated locally on Apple Silicon.
- Orca 1.4.257. The manifest minimum is 1.4.257; later releases must still pass runtime schema checks.
- Native Codex and Claude sessions, verified local Claude terminal sessions, and explicitly tracked terminal sessions.
- Unsupported or ambiguous identities never fall back to the most recent conversation.

## Internal read adapters

Automatic association currently needs local Orca implementation details because the public plugin API does not expose the full artifact-to-session evidence used here. All SQLite connections are read-only and closed after each operation.

| Input | Supported format |
| --- | --- |
| Profile index | schemaVersion 1 |
| Profile database | user_version 3 |
| workspaceSession document / sharded document | domain version 1 |
| Agent session journal | user_version 4 |
| Session records | schemaVersion 2 |
| Journal outcomes | format 3, uncompressed prefix 0 |
| Existing Claude terminal hook database | schema version 202; verified Darwin process identity |

A mismatch produces an explicit unavailable state. Directory discovery is independent of native session attribution and remains an alternative. Do not edit your Orca databases to satisfy these checks.

Focused group + unified-tab identity is authoritative when present. Legacy focus fields are used only for older records that do not contain unified tabs. Null, duplicate, remote or mismatched identities are rejected.

## Runtime requirements

The plugin relies on Orca's bundled Node runtime with `node:sqlite`, local filesystem access, and the `orca` CLI in the worker environment. Thumbnail tools are optional and detected at runtime. Remote hosts and Windows/Linux adapters are not supported in this first release.

## Release verification

The automated suite covers session isolation, schema rejection, focus switching, large cache storage, pagination, missing media dependencies, path/symlink checks and HTML preview isolation. Public CI uses macOS. A green synthetic test suite does not certify every future Orca schema or all real transcript variants.
