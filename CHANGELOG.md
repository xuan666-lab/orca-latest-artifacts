# Changelog

## Unreleased

- A file the agent wrote and then named in its final answer (as inline code, a link or in a code block) now counts as delivered, without needing words like "delivered". Files written but never named stay hidden.
- Claude terminals whose Orca hook record lacks a working directory are verified by their transcript folder instead of showing "not tracked".

## 0.1.2

- List only what the agent actually handed over: paths in a completed final answer, or verified registrations. Files merely written or edited along the way are no longer shown.
- Show each artifact's modified time and sort by time (newest first by default, oldest first on request).
- Say "Reading the session history" instead of an empty list while a long session is indexed for the first time.

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
