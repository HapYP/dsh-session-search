# Session content search

Adds two search surfaces that the built-in sidebar search box does not provide:

1. **Cross-workspace content palette** — press `Ctrl+Shift+F` or click the magnifier
   button at the sidebar foot. Type a keyword to full-text search the content of
   **all sessions in every workspace**, including user messages, assistant replies,
   tool calls (name + arguments), tool results, and todo entries. Pick a result to
   open that session. `Enter` opens the selected row, `↑`/`↓` move, `Esc` closes,
   and *Load more* pages through further hits.
2. **In-conversation find bar** — press `Ctrl+F` while a conversation is open (when
   the focus is not in a text editor). A find bar appears over the conversation and
   highlights every match in the currently rendered chat rows, with match counter,
   previous/next navigation, and smooth scrolling to each match. `Enter` / `Shift+Enter`
   step through matches, `Esc` closes.

## How it works

- The browser half renders the palette, find bar, and sidebar button, and talks to
  the Host half through an authenticated same-origin `/api` route.
- The Host half forwards queries to DSH's own `ctx.sessionQuery` full-text service
  (the SQLite FTS5 backend mounted by the built-in **Session search** plugin) and
  returns ranked hits with plain-text snippets. It never reads or writes session
  storage directly.

## Requirements and limits

- Full-text search needs the built-in **Session search** plugin to be enabled; when
  it is off, the palette explains that the backend is missing instead of failing
  silently.
- Matching is a **literal, case-insensitive, whitespace-flexible substring scan**:
  a fragment inside a word matches (`AI` finds `BRAID`), and words separated by
  arbitrary whitespace match each other. It is not token- or phrase-based.
- Reasoning ("thinking") text is not indexed by DSH and therefore not searchable.
- The `Ctrl+F` find bar searches what the conversation currently has rendered;
  very old turns that are not rendered yet are covered by the cross-workspace
  palette instead.
- The palette scans a bounded window of the newest sessions first (approximately
  forty), so results arrive in a few seconds. When you need older sessions, use
  *Scan older sessions* to page further. Inactive sessions are cached in Host
  memory once read (never on disk, at most 128 MB), so repeat searches over
  already-scanned sessions are near-instant.
