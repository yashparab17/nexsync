# Changelog

Nexsync follows [semantic versioning](https://semver.org). Release notes for each published version are also shown in
the app under **Settings → Updates & About → What's new**; they come from the body of the GitHub release.

## 0.9.0 (alpha)

The first build meant for testers. Expect rough edges and keep your own backups.

### Workspaces
- Create, import and open workspaces that live in a folder on your own computer. Notes, files, assets, tasks, a Kanban board and an editor for code, with a trash you can restore from.
- Notes float on a shared board, can be viewed as a graph of `[[links]]`, and keep their headings in the file.
- Version history, named versions, branches for notes and code, and export to a zip.

### Working together
- Invite people with a link or a six-digit code; no account and no server holds your data.
- Live co-editing of notes and code, with cursors, presence, "follow" and last-seen times.
- Roles (Owner, Admin, Editor, Viewer), unique names per workspace, host handoff.
- Members link to each other without the host and keep syncing while it is away. An optional setting makes a workspace read-only until the host is back.
- Changes made apart merge field by field, and real conflicts are kept for someone to choose.
- Removing a member takes effect as soon as it reaches a device, and for a device that was offline it takes effect at the latest 24 hours after the owner last signed the member list.

### The app
- Settings and workspace settings open as popups; a collapsible sidebar; light and dark themes; Plus Jakarta Sans.
- Two update channels, Stable and Beta, with release notes shown before you install.
- Errors and crashes are written to a log on your computer. "Copy diagnostics" gathers it for a bug report; nothing is sent anywhere.

### Known limits
See **Current limitations** in the README and `ALPHA_CHECKLIST.md`.
