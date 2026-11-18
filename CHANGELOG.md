# Changelog

## 0.1.5

- Works with Orca 1.4.261+, which moved Chat sessions to a new database. New Chats showed "unsupported session/provider/record version" and an empty list; they now list their artifacts. Chats from older Orca builds are still read from the old database.
- A session Orca has no record of now says so instead of blaming an unsupported version.

## 0.1.4

- Opening an artifact (or a browser tab) in the same workspace keeps the session's list instead of emptying it with a "not a native Chat" warning. Tabs from another workspace, or focus that cannot be verified, still clear it.
- A Claude terminal that has no Orca hook record now says why: it was started before Orca restarted, so its status reports no longer arrive. Resume it in a new terminal with `claude --resume`.

## 0.1.3

- Delivery no longer depends on wording. A file counts as delivered when the agent names it in a final answer (inline code, link or code block) and it was created or modified during that turn, or the agent wrote it with a file tool. Referenced files the turn did not touch, and working files never named, stay hidden. The previous keyword lists are gone.
- Script- or sub-agent-generated outputs that the answer names now appear.
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
