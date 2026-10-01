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
