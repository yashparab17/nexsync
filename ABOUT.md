# About Nexsync

Nexsync is a **local-first, peer-to-peer collaborative workspace** for notes, code, files, tasks and kanban boards. There's no account, no cloud, and no central server — your files live as plain files on your own disk, and collaboration happens by connecting your device directly to a collaborator's.

## Why

Most collaborative tools ask you to hand your files to someone else's server. Nexsync doesn't: a workspace is just a folder on your computer, and sharing it means two copies of the app talking to each other over an end-to-end encrypted connection, not a shared account on someone else's infrastructure.

## What it does

- **Notes & code** — a BlockNote rich-text editor for Markdown, CodeMirror for everything else, with live multi-cursor co-editing over a Yjs CRDT.
- **Tasks & Kanban** — stored in a local SQLite database per workspace, synced live with collaborators.
- **Files & Assets** — a real file explorer over your OS filesystem, with previews and on-demand download of large files.
- **P2P collaboration** — invite someone with a single pasteable ticket; connections punch through NATs directly when possible and fall back to an encrypted relay when not.
- **Roles** — Owner, Editor and Viewer, enforced both in the UI and on the wire.
- **Auto-updates** — signed release builds, checked and installed from inside the app.

## Built with

Tauri 2 (Rust) + React 19 + TypeScript on the frontend, Iroh for P2P networking, Yjs for CRDT sync, SQLite for structured data.
