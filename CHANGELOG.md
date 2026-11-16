# Changelog

## 0.1.1

- Index existing Claude terminal histories from the beginning in bounded batches, so older artifact writes remain discoverable in long sessions.
- Automatically rebuild legacy tail-only caches; subsequent reads remain incremental.
- Keep workspace-boundary and successful-write verification unchanged.

## 0.1.0

Initial public macOS release.

- Latest productive-turn artifact list for native sessions, with verified terminal-session discovery.
- Filename-first layout, optional thumbnails, in-Orca opening, Chinese and English UI.
- Fast focus probing and coalesced refresh notifications.
- Authoritative group/unified-tab focus handling; stale results are not published after a switch.
- Bounded local storage and paginated worker-side filtering for large histories.
- Optional renderer detection with graceful file-type placeholders.
- No custom annotation overlay, annotation editor or agent-send capability.
