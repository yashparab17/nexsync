# Literature review: where CRDT collaboration falls short, and what Nexsync can do about it

Written October 2026. **How this was done:** web searches over arXiv, ACM, Ink & Switch, vendor documentation and engineering blogs, then reading the abstract or main argument of the papers marked (read). Papers marked (snippet) were only seen through search summaries, and I have not read them in full. Nothing here is a claim about what the full papers prove. Check a paper before citing it in the report.

## 1. What the current systems do

| System | Approach | Source |
|---|---|---|
| Automerge 3 | JSON CRDT with full history, Peritext for rich text, columnar storage; branching and diffs come from keeping every change | [Patchwork notebook](https://www.inkandswitch.com/patchwork/notebook/08/) (snippet) |
| Yjs / Loro | Sequence CRDTs (Yjs; Loro uses Fugue and a movable tree); Loro garbage-collects tombstones once all peers have acknowledged | [Loro rich text](https://loro.dev/blog/loro-richtext), [movable tree](https://loro.dev/blog/movable-tree) (snippet) |
| Eg-walker | Stores an event graph and replays it only when branches diverge; far less memory and faster load than CRDTs, faster long-branch merges than OT | [Gentle and Kleppmann, 2025](https://martin.kleppmann.com/2025/04/02/eg-walker-collaborative-text.html) (snippet) |
| Keyhive | Access control for local-first apps: convergent capabilities, a group-management CRDT with revocation, end-to-end encryption (BeeKEM) | [Ink & Switch notebook](https://www.inkandswitch.com/keyhive/notebook/) (read) |
| Upwelling / Patchwork | Branches, drafts and pull-request-style review on top of a CRDT; Patchwork extended branching and diffs to Kanban boards and spreadsheets | [Upwelling](https://www.inkandswitch.com/upwelling/), [Patchwork](https://www.inkandswitch.com/project/patchwork/) (snippet) |
| Figma | Not a true CRDT: a central server, with last-writer-wins per property | [Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) (snippet) |
| Notion | Text merges, but non-text edits (properties, block moves, row deletes) can conflict; it keeps "(Conflict)" duplicates | [guide](https://notionbackups.com/guides/notion-offline-mode) (snippet, third-party) |
| DynamoDB global tables | Last-writer-wins by timestamp; the losing write is gone and conflicts are not recorded | [AWS docs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.html) (snippet) |

DynamoDB's conflict handling is therefore a record-level register, the strategy Nexsync's own simulation shows losing 48.6% of offline edits. Google Docs is OT with a central server, so it cannot work peer to peer.

## 2. Shortcomings reported in the literature

**S1. Convergence does not mean the result is correct.** Causal consistency cannot maintain invariants that need coordination, such as a vacation balance ([LoRe](https://arxiv.org/pdf/2304.07133), snippet). Merge results can be valid CRDT states but wrong for the application, for example broken references or duplicate declarations (snippet from a 2026 survey page, no primary source found).

**S2. Conflict resolution is implicit.** The merge picks a result and the user is never told. [Semenov and Aksenov, PaPoC '26](https://arxiv.org/abs/2602.19231) (abstract read) propose explicit, local-first resolution by rebasing over a replicated journal, shown on registers only.

**S3. Access control is unfinished.** [Jacob, Stuber and Hartenstein, April 2026](https://arxiv.org/abs/2604.23560) (abstract read) say Matrix and Keyhive pair an informal specification with an unverified implementation and need Byzantine tolerance. Keyhive's own notebook lists open problems: concurrent revocation ("two admins concurrently revoke each other"), no forward secrecy because keys for causal predecessors travel with each chunk, key-agreement cost degrading from logarithmic towards linear under concurrency, and a tension between sync metadata and metadata privacy.

**S4. Text CRDTs are complex and opaque.** [Weidner, 2025](https://mattweidner.com/2025/05/21/text-without-crdts.html) (read) argues the total orders are subtle and treated as black boxes, which blocks features like suggested changes and sub-document permissions (his own suggestions drifted from their target text). His alternative needs a central server and gives unintuitive ordering for concurrent inserts.

**S5. Moves, duplicates and ordering.** Concurrent moves can duplicate nodes or create cycles; Kleppmann's [movable tree](https://martin.kleppmann.com/papers/move-op.pdf) and [JSON move](https://arxiv.org/pdf/2311.14007) work addresses it (snippets).

**S6. History is both the feature and the liability.** Automerge keeps everything, which enables diffs and branches, but compaction destroys what an offline returner needs, and deletion must reach the log and every snapshot, which sits badly with erasure rights (blog-level source, weak). The [Promises and Pitfalls](https://aaltodoc.aalto.fi/items/473870e8-2fc4-44f6-8562-7dff022f2206) thesis (snippet) also names memory overhead and says local-first fits asynchronous collaboration but not financial or very large data.

**S7. Schema evolution between app versions.** Peers running different versions edit the same data. [Cambria](https://www.inkandswitch.com/cambria/) (snippet) uses bidirectional lenses for this; it is a known gap for CRDT apps that ship updates.

**S8. Review and trust of merged work.** Upwelling's "fishbowl effect" finding is that live co-editing makes writers feel watched; it adds private drafts and review. Patchwork shows branching beyond text, but only as research prototypes.

**S9. Reordering and starvation.** [Kuznetsov et al.](https://arxiv.org/abs/2508.18193) (abstract read) show that operations can be constantly reordered and that a client's operations can be starved of effect; they add stability and fairness properties. Theoretical, and not a priority here.

## 3. What Nexsync already addresses

| Shortcoming | Nexsync today | Gap that remains |
|---|---|---|
| S2 explicit conflicts | Multi-value registers with a shown conflict and a resolve action, for tasks and cards (`crdt.rs`); a catch-up review lists every merged change by author with undo (`catchup.rs`, built October 2026, improvement C) | Text conflicts are still implicit; live-synced text is not journaled |
| S1 correctness | Parse check and repair hunks for code (`mergeRepair.ts`); two opt-in cross-field rules for tasks and cards, with the rate at which merging breaks them measured at 20.1% in a hostile simulation (`invariants.rs`, improvement A, built October 2026) | Two fixed rules, detection only |
| S8 / Patchwork | Branches with a reviewed merge, for text files; per-record drafts of tasks and cards whose review predicts collisions before merging (`drafts.rs`, improvement B, built October 2026) | No draft of a whole board; drafts are private and local |
| S5 moves | Card position by number | Not a list-move CRDT; stated as a limit in `RESEARCH.md` |
| S3 access | Roles, device blocking, OS credential store, relay/proxy; every task and card write signed with the device key and checked on receipt (`signing.rs`, improvement D, built October 2026) | Roles are not enforced from signatures, there is no key revocation, text edits are not signed |

I have not audited how roles are enforced on received data. Whether a malicious peer can write past its role is a question to settle by reading the P2P code before claiming anything about it.

## 4. Where Nexsync could contribute

Ranked by how well each is supported by the literature, how much of it is already in the code, and how measurable it is.

**A. Declared invariants checked at merge time (S1, LoRe).** Each record type states rules ("a done task has an assignee", "start precedes due date", "a card's list exists"). After merging, a violated rule becomes a conflict in the same panel. The recovered-column rule is already an instance. The simulator in `crdt_sim.rs` can measure how often concurrent edits violate each rule without any check. The measurement is the contribution, since existing papers prove which invariants need coordination, and few apps report how often they are violated in practice.

**B. Branches for structured data (S8).** Extend `branches.ts` to a fork of a Kanban board or task list, with a review step showing what the merge would change. Patchwork did this as a prototype. Doing it on a per-field multi-value merge, where review can show field-level conflicts before merging, is a different design point from Automerge's.

**C. Catch-up review (S2, S8).** After reconnecting, show what merged while away, grouped by author, with per-hunk revert for text and per-field revert for records. This is the user-facing form of S2 for the cases the CRDT resolves silently.

**D. Signed operations (S3).** Sign each record write with the device key, so a peer cannot forge another's edits and history is attributable. This is the smallest honest step into the Byzantine setting. It does not solve revocation, and I would say so.

**E. Version skew handling (S7).** Records carry a schema version; an older client keeps unknown fields intact rather than dropping them, and a newer client refuses or upgrades. A small, practical gap in a shipped P2P app; weaker as research, stronger as engineering.

**F. List-move CRDT for card order (S5).** Closes a limit already listed in `RESEARCH.md`. Well studied, so engineering rather than new research.

Not recommended now: replacing Yjs with an event-graph approach (S4, Eg-walker), because the study showed text convergence is not Nexsync's problem; and AI agents as replicas, which you deferred.

## 5. Suggested order

1. A with measurement (new, measurable, builds on `crdt_sim.rs`).
2. C (visible in a demo, builds on repair hunks).
3. B (extends the existing branches work).
4. D, if time allows, as a stated partial step.

Whether a combination of A, B and C is new is something this search cannot establish. I found no system doing all three on a multi-value record merge, but a search of this size cannot rule one out. Phrase it as "I did not find", as `RESEARCH.md` already does.

## 6. Collaborative apps in use today, and whether Nexsync improves on them

Sections 1 to 5 above are from research papers and engineering notes. This section looks at products people use now. **Source quality matters here:** claims marked *(vendor)* were checked against the vendor's own documentation or ticket tracker; *(third party)* claims come from blogs and guides and could be out of date.

### 6.1 What each one does, and where it falls short

| App | How it handles concurrent and offline edits | Shortcoming | Source |
|---|---|---|---|
| **Figma** | A server holds one value per property per object; the last value to reach the server wins. Unrelated properties never conflict. Offline edits are reapplied on top of a fresh copy after reconnecting. | Two people editing the same text cannot be merged: if one makes it "AB" and another "BC", the result is one of them and never "ABC". Figma calls this acceptable for a design tool. It is "inspired by" CRDTs, not one, and needs its server. | [Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) *(vendor)* |
| **Jira** | Saving an issue replaces what is stored (last write wins). | One person's save overwrites another's "without even knowing it". A request for a version check has **200 votes** and the status "Gathering Interest". | [JRACLOUD-37142](https://jira.atlassian.com/browse/JRACLOUD-37142) *(vendor)* |
| **Word (co-authoring)** | Works only for `.docx` files stored on OneDrive, Dropbox or SharePoint, online. Editing the same section while offline produces a conflict. | The document is **not saved online until a person resolves the conflict in a Conflicts tab**. No co-authoring for older formats, macro-enabled files or files marked final. | [Microsoft](https://support.microsoft.com/en-us/office/why-can-t-i-simultaneously-work-with-others-on-a-shared-document-983cd676-2dd9-4586-a28a-368c1c6311fe) *(vendor)* |
| **Obsidian Sync** | Markdown notes are merged with Google's diff-match-patch. Other files, canvases included, use "last modified wins". An optional setting creates a "Conflicted copy" file instead of merging. | A text merge can leave duplicated text for a person to clean up (third party). Canvases and attachments silently lose the older edit. The conflict setting must be chosen on each device separately. | [Obsidian](https://obsidian.md/help/sync/troubleshoot) *(vendor)*. The duplicated-text warning appeared in a search summary of Obsidian's help; the page I fetched did not repeat it, so treat it as unconfirmed. |
| **Google Docs / Sheets** | Operational transformation through Google's server. Offline editing has to be switched on and covers the files made available offline. | Live collaboration does not work offline, and sharing cannot be changed offline. Reports say it keeps the most recent edit and may ask a person to choose; the behaviour is not documented in one place. Version history attributes at the level of a version, not each edit, and named versions are capped (40 per document). | third party: [MakeUseOf](https://www.makeuseof.com/is-google-docs-offline-mode-really-offline/), [Google Help](https://support.google.com/docs/answer/190843) |
| **Notion** | Text merges. Non-text edits (properties, block moves, database rows) can still conflict, and Notion warns of it. | Offline use needs each page marked "Available offline" on each device; sub-pages do not come with the parent; database views are limited to the first 50 rows; sharing, forms, relations and automations need the server. | third party: [TechCrunch](https://techcrunch.com/2025/08/20/finally-notion-now-works-without-an-internet-connection/), [guide](https://notionbackups.com/guides/notion-offline-mode) |
| **DynamoDB global tables** | Last writer wins by timestamp. | The losing write is gone and the conflict is not recorded. | [AWS](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.html) *(vendor, via search summary)* |

The pattern across them: structured data (Jira, Figma properties, DynamoDB, Obsidian's non-text files) uses **last writer wins and loses an edit without saying so**; text is merged but the merge **is not shown to anyone** (Obsidian, Google, Notion), or **blocks until a person resolves it** (Word); and almost all of it **needs a server**.

### 6.2 Does Nexsync improve on them?

Compared honestly, row by row. "Better" means better on the specific shortcoming named, not better as a product.

| Shortcoming in the apps | Nexsync | Verdict |
|---|---|---|
| Last writer wins loses an edit silently (Jira, Figma properties, Obsidian non-text files, DynamoDB) | Tasks and cards merge field by field; a field both sides changed is kept as a conflict for a person to choose. In the simulation of section 1 this loses 0% of offline edits, against 48.6% for a whole-record rule. | **Better** for tasks and cards, measured. |
| A save overwrites a concurrent change without warning (Jira) | An edit carries the copy it started from, so a stale dialog cannot write old values over a newer change. | **Better**, tested. |
| Merged text is never shown to the person (Google, Obsidian, Notion) | The catch-up review lists changes by author and undoes one. Text is only listed when it arrives through the note catch-up. | **Partly better.** Text typed live in an open note is not reviewed. |
| Merged text can be broken (Obsidian's duplicates) | Code is checked for syntax errors after a merge and a repair is suggested (a part of the change could be kept in 49.3% of broken merges). | **Better for code**, from a generated-edit study; **nothing for prose**. |
| Merging blocks until resolved (Word) | Merging never blocks; conflicts wait beside the record. | **Better** on blocking; Word's resolution view is the more polished one. |
| Needs a server, or specific cloud storage (Word, Figma, Google, Notion) | Peer to peer, a database per workspace on the device, the whole workspace available offline. Notion's per-page and 50-row limits do not exist. | **Better** by design. The cost is that devices must meet to sync. |
| Conflict choices are per device (Obsidian) | The rules of section 5 are also kept per device. | **Same weakness.** |
| Attribution is coarse (Google version history) | Each field change is attributed, and signed with a device key. | **Better** for tasks and cards; text edits are not signed. |
| Non-text files lose the older edit (Obsidian canvases) | When a file differs on both sides the sync keeps a "conflict" copy of the local one, and backs up a file before replacing it. | **Comparable** to Obsidian's conflicted-copy setting. |

**Where the established apps are simply ahead, and Nexsync does not compete:** scale (thousands of simultaneous editors), rich-text and spreadsheet depth, mobile apps, server-side features such as automations and search across everything, an audited security model, and years of use by real teams. Nexsync has had no user study, and the new interface has not been run in a window by anyone but its author.

### 6.3 Gaps this study leaves open

In order of how directly the evidence points to them:

1. **Review of text typed live.** Every app above that merges text hides the merge; Nexsync's review covers records fully and text only through closed-note catch-up. Journaling live edits (per author, per run of lines) would extend it to the case the study says nobody covers. *This is the most justified next step.*
2. **Suggested edits in text.** Google's suggesting mode is the only app here with per-edit attribution inside text. Nexsync has file branches (section 3) and record drafts (section 7), but no inline suggestion that a collaborator can accept or reject. Weidner's note (S4) says this is hard for CRDT text with an opaque order; a branch-based design avoids that problem.
3. **A whole-board draft.** Jira's 200-vote request is for protection against overwrites on a single issue, which Nexsync covers; the harder case, changing several cards as one reviewable unit, is not covered (stated as a limit of drafts).
4. **Shared rules.** Obsidian's per-device conflict settings are called out as a weakness; Nexsync's rules share it. Putting the choice in the workspace metadata would make it the same on every device, at the price of one more thing the host controls.

### 6.4 More apps (second pass)

Same marking as above. Where a claim rests only on community threads or marketing blogs it says so, and some are left out because they could not be confirmed.

| App | What it does | Shortcoming | Source |
|---|---|---|---|
| **Confluence** | With collaborative editing on, a shared draft is edited live; with it off, edits are merged on save. | At most **12 people** can edit a page at once. **No versions are kept of unpublished changes.** "All page changes are currently attributed to the person that publishes the page, rather than the people who made each specific change." With the merge-on-save mode, overlapping edits or two people editing one table can lose work, and the person is offered Overwrite, Merge or Discard (third party). | [Atlassian](https://confluence.atlassian.com/doc/administering-collaborative-editing-858772086.html) *(vendor)*; data loss: [community thread](https://community.atlassian.com/forums/Confluence-questions/Why-won-t-Confluence-merge-concurrent-edits/qaq-p/582197) *(third party)* |
| **Dropbox** | When two people change a file at once, **"Dropbox won't try and merge the changes"**; it keeps a second file named "conflicted copy". | Two whole files and a person who must reconcile them by hand, for every file type. | [Dropbox](https://learn.dropbox.com/self-guided-learning/help-desk-course/common-team-member-challenges) *(vendor)* |
| **Apple Notes** | Shared notes sync through iCloud. | Only notes in iCloud can be shared, only between Apple accounts, locked notes cannot be shared, and the limit is 100 people. Reports of duplicate "conflict copy" files or silently dropped edits after offline use (third party). | [Apple](https://support.apple.com/en-us/102462) *(vendor)* |
| **Miro** | Real-time boards on a server; no offline mode (community threads). | A confirmed known bug: when several people move or create cards on a Kanban board at the same time, "the changes may not register properly (e.g., cards jumping back)". Reported April 2025, no fix date given. | [Miro community](https://community.miro.com/ask-the-community-45/known-bug-bug-with-simultaneous-editing-20947) *(vendor forum)* |
| **Git and GitHub** | A textual merge: changes to different lines are combined without a conflict. | A merge that applies cleanly can still break the build or behaviour (a "semantic merge conflict"), and a textual conflict can be reported where there is none. Research on repairing this exists but is not part of the tools. | [Microsoft Research](https://www.microsoft.com/en-us/research/uploads/prod/2022/07/issta22-merge-conflicts-llm.pdf), [arXiv 2102.11307](https://arxiv.org/pdf/2102.11307) *(papers)* |
| **Local-first rivals** (Anytype, AppFlowy, Logseq, AFFiNE) | Peer-to-peer or CRDT sync, offline by design. | Anytype: devices must be online together at some point to exchange changes. AppFlowy: occasional manual conflicts with five or more editors on one block. Logseq: no real multi-user editing; its real-time version is alpha and invite-only. | [comparison blogs](https://affine.pro/blog/affine-vs-appflowy-vs-anytype) *(third party, and AFFiNE's own blog is a competitor, so low confidence)* |
| **Airtable, Linear** | Not confirmed. | The Airtable material was community threads and unrelated issue trackers mixed together. For Linear, one search summary said last-writer-wins and a reverse-engineering write-up said a central server orders every change; neither is official. **I am not citing either.** | none |

New pattern from this pass: **attribution is weak** (Confluence credits the publisher, Google credits a version, Dropbox only knows a device name), **ordering is fragile** (Miro's cards jumping back, Notion's block moves), **whole-file conflicts are never merged** (Dropbox, Obsidian's non-text files, iCloud), and **a clean merge is not a correct one** (Git), which is the same finding as section 2 of `RESEARCH.md`.

### 6.5 Does Nexsync improve on these?

| Shortcoming | Nexsync | Verdict |
|---|---|---|
| Changes credited to whoever saved (Confluence), or to a version (Google) | Each change to a task or card is attributed to its writer and signed by a device key. **Text is not attributed per change**: a note's history records who saved a snapshot, not who typed which part. | **Better for records. Not for text.** |
| Cards jump back when moved at once (Miro) | A card moved to two lists at once keeps both values as a visible conflict instead of reverting. **Order within a list is by a position number, which is not a list-move CRDT**, and `RESEARCH.md` already lists this as a limit. | **Better across lists, same weakness inside a list.** |
| Whole files are never merged (Dropbox, iCloud, Obsidian non-text) | A conflict copy is kept; there is no merge for non-text files. | **Same.** |
| A clean merge that is wrong (Git) | A study of 7,799 generated merges found 8.0% broken; the editor flags it and suggests a repair for code. Records have opt-in rules. | **Better for code and two record rules.** The study is generated edits, not real merge history. |
| Page and editor limits (Confluence: 12 editors, Apple: 100 people) | **Not measured.** The merge has no stated limit, but nothing here tests many peers or many records. | **Unknown.** This is a gap in the evidence, not a strength. |
| Locked into one vendor's devices (Apple Notes, Dropbox Paper) | A desktop app with no account, built to run on Windows and macOS (I have only built and run it on Windows); no phone or tablet app. | **Better on lock-in, worse on reach.** |
| Peers must overlap in time (Anytype) | A host can relay between guests, but two devices that are never online together with a host between them cannot exchange changes. | **Same weakness.** |
| No versions of unsaved work (Confluence) | Notes and code files are snapshotted automatically and can be restored. | **Better.** |

### 6.6 Gaps, updated after the second pass

In order of how strongly the evidence points to them and how much of it Nexsync can actually fix:

1. **Review and attribution of text typed live.** Every text app in both tables hides the merge or credits the wrong person; Nexsync covers records but only part of text. Journaling live edits per author closes both halves at once.
2. **Concurrent moves inside a list.** Miro has a confirmed bug and Notion warns about block moves; Nexsync's card order is a known open limit. A movable-list CRDT (Kleppmann's move work, section 4 S5) fixes it and can be measured the way the field merge was.
3. **A scale measurement.** Confluence states 12 editors and Apple 100; Nexsync states nothing and has measured nothing. A simulation of many peers and many records (merge time, state size, convergence) would turn "unknown" into a number, in either direction.
4. **Inline suggested edits in text** (Google's suggesting mode), built on file branches.
5. **A draft of a whole board**, and **workspace-wide rules**, from the first pass.

Two weaknesses are shared with the established apps and not planned: non-text files get a conflict copy and no merge, and two devices that are never online together cannot exchange changes without a host between them.

Not looked at: Slack, Coda, Notion's own database sync internals, Overleaf. They would add cases, not change the pattern. Four of the sources above are community threads or competitors' blogs, and are marked so.

### 6.7 Status of these gaps (October 2026)

All five were built afterwards; `RESEARCH.md` has the evidence and the limits. In short: (1) live typing is journaled per author, which also exposed that the backend never stamped an author on note updates; (2) card order now uses fractional positions, which misplaced 0.0% of simulated concurrent drops against 15.7% for renumbering (this is fractional indexing, not a full movable-list CRDT); (3) scale was measured in simulation, about 1.3 KB of record state per device, with the app refusing records over 64 replicas, and nothing measured on a real network; (4) inline suggestions are anchored with Yjs relative positions, in code and Markdown files only; (5) a board draft moves cards as one reviewable, all-or-nothing merge, and the host's rule choices now apply to every guest. Not addressed: schema skew between app versions, key revocation, and any user study.
