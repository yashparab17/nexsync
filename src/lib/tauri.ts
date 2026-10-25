import { forgetWorkspace } from "@/lib/forgetWorkspace";
import { forgetRecent, renameRecent } from "@/lib/recentFiles";
// Typed wrapper around Tauri IPC commands
// All backend invocations go through these functions to keep IPC calls type-safe
// P2P commands live in src/lib/p2p/transport.ts

import type { LoggedWrite } from "@/lib/timescrub";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cleanPath } from "@/lib/utils";
import type { EntryKind, LogEntry } from "@/features/chat/lib/entries";
import type { ModerationView } from "@/features/moderation/lib/moderation";
import type { LspStatus } from "@/features/projects/types";
import type { ImportAnswer, OfficeInspect, OfficeLayout } from "@/features/office/types";
import type { ChartPrim, SheetIn, SheetOut } from "@/features/office/sheets/lib/sheet";
import type { Frame } from "@/features/office/slides/lib/deck";
import type { Audit, Bisected, Containers, RuntimeInfo, DepsStatus, Found, Impact, GeneratorList, HttpFile, HttpResponse, Planned, Doctor, EnvState, ImportPreview, ProjectInfo, Recipe, ReportFile, RunRecord, Scan, Template, ToolReq, Trust } from "@/features/projects/types";

import type {
	WorkspaceInfo,
	WorkspaceMetadata,
	WorkspaceFile,
	WorkspaceStats,
	FileVersion,
	ErrorRecord,
	TrashItem,
	DeleteOutcome,
	CreateWorkspaceRequest,
	UpdateMetadataRequest,
	Task,
	KanbanColumn,
	KanbanCard,
	TaskRequest,
	TaskIdRequest,
	KanbanColumnRequest,
	KanbanCardRequest,
	MoveCardRequest,
	NexsyncConfig,
	CatchupEntry,
	RuleInfo,
	Draft,
	DraftPreview,
	BoardDraft,
	BoardPreview,
} from "@/types/workspace";

// ────────────────────────────
// Session Token State
// ────────────────────────────

let activeSessionToken: string | null = null;

// Store the active session token in memory
export function setActiveSessionToken(token: string | null) {
	activeSessionToken = token;
}

// Get the current active session token
export function getActiveSessionToken(): string | null {
	return activeSessionToken;
}

// ────────────────────────────
// Session Management Commands
// ────────────────────────────

// Create a new session for the workspace
export function createWorkspaceSession(workspacePath: string): Promise<string> {
	return invoke("create_workspace_session", { workspacePath });
}

// Close an active workspace session
export function closeWorkspaceSession(sessionId: string): Promise<void> {
	return invoke("close_workspace_session", { sessionId });
}

// Fetch session info including role and created timestamp
export function getCurrentSessionInfo(
	sessionId: string,
): Promise<{
	sessionId: string;
	workspacePath: string;
	userRole: string;
	createdAt: string;
} | null> {
	return invoke("get_current_session_info", { sessionId });
}

// ────────────────────────────
// Error logging
// ────────────────────────────

// Append an error record to app-level error log
export function logError(entry: ErrorRecord): Promise<void> {
	return invoke("log_error", { entry });
}

// Read the most recent error records, newest first
export function getErrorLog(limit = 200): Promise<ErrorRecord[]> {
	return invoke("get_error_log", { limit });
}

// Delete the app-level error log
export function clearErrorLog(): Promise<void> {
	return invoke("clear_error_log");
}

// Move a whole workspace to the operating system recycle bin
export function deleteWorkspace(path: string): Promise<DeleteOutcome> {
	return invoke("delete_workspace", { path });
}

// ────────────────────────────
// Trash
// ────────────────────────────

// List deleted items, newest first
export function listTrash(path: string): Promise<TrashItem[]> {
	return invoke("list_trash", { path });
}

// Move a trashed item back to where it was
export function restoreTrashItem(path: string, id: string): Promise<void> {
	return invoke("restore_trash_item", { path, id });
}

// Permanently delete one trashed item
export function purgeTrashItem(path: string, id: string): Promise<void> {
	return invoke("purge_trash_item", { path, id });
}

// Permanently delete everything in the trash
export function emptyTrash(path: string): Promise<void> {
	return invoke("empty_trash", { path });
}

const tidy = (w: WorkspaceInfo): WorkspaceInfo => ({ ...w, path: cleanPath(w.path) });

// ────────────────────────────
// Workspace creation & import
// ────────────────────────────

// Create a new workspace directory and database
export function createWorkspace(
	request: CreateWorkspaceRequest,
): Promise<WorkspaceInfo> {
	return invoke<WorkspaceInfo>("create_workspace", { request: { ...request, path: cleanPath(request.path) } })
		.then(tidy)
		.then((w) => (forgetWorkspace(w.path), w));
}

// Import an existing workspace from disk
export function importWorkspace(path: string): Promise<WorkspaceInfo> {
	return invoke<WorkspaceInfo>("import_workspace", { path: cleanPath(path) }).then(tidy);
}

// ────────────────────────────
// Metadata read & write
// ────────────────────────────

// Load full workspace metadata from database
export function readWorkspaceMetadata(
	path: string,
): Promise<WorkspaceMetadata> {
	return invoke<WorkspaceMetadata>("read_workspace_metadata", { path }).then((m) => ({ ...m, workspace: { ...m.workspace, path: cleanPath(m.workspace.path) } }));
}

// Persist updated workspace metadata to database
export function writeWorkspaceMetadata(
	request: UpdateMetadataRequest,
): Promise<void> {
	return invoke("write_workspace_metadata", { request });
}

// ────────────────────────────
// Task commands
// ────────────────────────────

// Fetch all tasks for a workspace
// Who is making changes, so a value that later collides with someone else's can say whose it was
let writeAuthor: () => string | undefined = () => undefined;
export function setWriteAuthor(source: () => string | undefined): void {
	writeAuthor = source;
}

// With `withState`, each task carries the merge state other devices need (for sending a whole workspace)
export function getTasks(path: string, withState = false): Promise<Task[]> {
	return invoke("get_tasks", { path, withState });
}

// Create a new task in the workspace
export function createTask(request: TaskRequest): Promise<Task> {
	return invoke("create_task", { request: { ...request, author: writeAuthor() } });
}

// Update an existing task
export function updateTask(request: TaskRequest): Promise<void> {
	return invoke("update_task", { request: { ...request, author: writeAuthor() } });
}

// Delete a task by ID
export function deleteTask(request: TaskIdRequest): Promise<void> {
	return invoke("delete_task", { request });
}

// What an erase removed, store by store
export interface Erased {
	records: number;
	journal: number;
	activity: number;
	drafts: number;
	versions: number;
	documents: number;
	trash: number;
	files: number;
}

// Erase a task or card for good on this device: its journal entries, drafts and activity too
export function eraseRecordForGood(path: string, entity: "task" | "card", id: string): Promise<Erased> {
	return invoke("erase_record_for_good", { path, entity, id });
}

// Erase a file or folder for good on this device: its trash copy, saved versions, shared text and journal entries too
export function eraseFileForGood(path: string, relPath: string, docIds: string[] = []): Promise<Erased> {
	return invoke("erase_file_for_good", { path, relPath, docIds });
}

// ────────────────────────────
// Chat, comments and the inbox
// ────────────────────────────

// What the chat and comment views read: every entry of the signed log, the read markers, and this device's key
export interface ChatState {
	entries: LogEntry[];
	read: { channel: string; lastTs: number; muted: boolean }[];
	me: string;
	seen: Record<string, number>; // When this device first held each entry
}

export interface InboxItem {
	id: number;
	kind: string; // "mention", "reply", or a notice the app wrote
	reference: string;
	channel: string;
	author: string;
	snippet: string;
	at: number;
	read: boolean;
}

// A write to a task or card held for an Admin, because the key that signed it may not write now
export interface HeldWrite {
	id: number;
	entity: "task" | "card";
	record: string;
	title: string; // The record's title here, or empty
	path: string; // The field
	value: string; // As JSON text
	by: string; // Device key
	who: string; // The name it wrote under
	ts: number;
	heldAt: number;
	reason: string;
}

export function moderationState(path: string): Promise<ModerationView> {
	return invoke("moderation_state", { path });
}

export function heldList(path: string): Promise<HeldWrite[]> {
	return invoke("held_list", { path });
}

// Erases what the expiry entries say is due on this device; resolves to how many things were erased
export function expirySweep(path: string): Promise<number> {
	return invoke("expiry_sweep", { path });
}
// A signed bundle of the workspace, for moving it between devices with no network (see workspace/bundle.rs)
export interface BundleSummary {
	by: string;
	created: number;
	epoch: number;
	entries: number;
	tasks: number;
	cards: number;
	files: number;
	docs: number;
	skipped: number;
	newerList: boolean;
}
export interface BundleReport {
	listTaken: boolean;
	entriesAdded: number;
	entriesRefused: number;
	dataChanged: boolean;
	filesWritten: number;
	filesKept: number;
	docs: [string, string][]; // Document id and its stored state as base64, for the app to merge
}
export function bundleExport(path: string, dest: string): Promise<number> {
	return invoke("bundle_export", { path, dest });
}
export function bundleInspect(path: string, source: string): Promise<BundleSummary> {
	return invoke("bundle_inspect", { path, source });
}
export function bundleImport(path: string, source: string): Promise<BundleReport> {
	return invoke("bundle_import", { path, source });
}
export function recordHistory(path: string, entity: "task" | "card", id: string): Promise<LoggedWrite[]> {
	return invoke("record_history", { path, entity, id });
}
// Chat messages and comments from a timed-out member, kept for an Owner or Admin
export function heldEntriesList(path: string): Promise<LogEntry[]> {
	return invoke("held_entries_list", { path });
}
export function heldEntryAccept(path: string, id: string): Promise<void> {
	return invoke("held_entry_accept", { path, id });
}
export function heldEntryDiscard(path: string, id: string): Promise<void> {
	return invoke("held_entry_discard", { path, id });
}
export function heldReviewGet(path: string): Promise<boolean> {
	return invoke("held_review_get", { path });
}
export function heldReviewSet(path: string, on: boolean): Promise<void> {
	return invoke("held_review_set", { path, on });
}
export function heldAccept(path: string, id: number): Promise<void> {
	return invoke("held_accept", { path, id });
}

export function heldDiscard(path: string, id: number): Promise<void> {
	return invoke("held_discard", { path, id });
}

// A change by a member that is in the journal, and whether undoing it is safe
export interface MemberChange {
	entry: CatchupEntry;
	replaced: boolean; // The field shows someone else's value now
	builtOn: boolean; // Others wrote in the record afterwards
}

export function getMemberChanges(path: string, key: string, name: string): Promise<MemberChange[]> {
	return invoke("get_member_changes", { path, key, name });
}

export function chatState(path: string): Promise<ChatState> {
	return invoke("chat_state", { path });
}

// Writes an entry as this device, stores it and sends it to the others; the result is the signed entry
export function chatPost(args: { path: string; kind: EntryKind; channel: string; parent?: string; body: string; name: string }): Promise<LogEntry> {
	return invoke("chat_post", { path: args.path, kind: args.kind, channel: args.channel, parent: args.parent ?? "", body: args.body, name: args.name });
}

// Seals text for one member's device; the result is the body of a "dm" entry
export function dmSeal(to: string, text: string): Promise<string> {
	return invoke("dm_seal", { to, text });
}
export function dmChannel(withKey: string): Promise<string> {
	return invoke("dm_channel", { with: withKey });
}
// Opens the direct messages among these entries that this device wrote or was sent: entry id to text
export function dmOpen(entries: [string, string, string][]): Promise<Record<string, string>> {
	return invoke("dm_open", { entries });
}
export function chatGetHistoryLimit(path: string): Promise<number> {
	return invoke("chat_get_history_limit", { path });
}

export function chatSetHistoryLimit(path: string, limit: number): Promise<void> {
	return invoke("chat_set_history_limit", { path, limit });
}

export function chatMarkRead(path: string, channel: string, ts: number): Promise<void> {
	return invoke("chat_mark_read", { path, channel, ts });
}

export function chatSetMuted(path: string, channel: string, muted: boolean): Promise<void> {
	return invoke("chat_set_muted", { path, channel, muted });
}

export function inboxList(path: string): Promise<InboxItem[]> {
	return invoke("inbox_list", { path });
}

// Keeps a notice the app wrote (a member joined, a task was assigned) so it survives a restart
export function inboxAdd(path: string, kind: string, reference: string, snippet: string, channel?: string, author?: string): Promise<void> {
	return invoke("inbox_add", { path, kind, reference, snippet, channel, author });
}

// Marks the given inbox items read, or all of them when none are given
export function inboxMarkRead(path: string, ids: number[] = []): Promise<void> {
	return invoke("inbox_mark_read", { path, ids });
}

export function inboxClear(path: string): Promise<void> {
	return invoke("inbox_clear", { path });
}

// ────────────────────────────
// Kanban commands
// ────────────────────────────

// Fetch kanban board columns and cards
export function getKanban(path: string, withState = false): Promise<KanbanColumn[]> {
	return invoke("get_kanban", { path, withState });
}

// Create a new kanban column
export function createKanbanColumn(
	request: KanbanColumnRequest,
): Promise<KanbanColumn> {
	return invoke("create_kanban_column", { request });
}

// Create a new kanban card
export function createKanbanCard(
	request: KanbanCardRequest,
): Promise<KanbanCard> {
	return invoke("create_kanban_card", { request: { ...request, author: writeAuthor() } });
}

// Update card title, description, or column
export function updateKanbanCard(request: KanbanCardRequest): Promise<void> {
	return invoke("update_kanban_card", { request: { ...request, author: writeAuthor() } });
}

// Move card to a new column and position
export function moveKanbanCard(request: MoveCardRequest): Promise<void> {
	return invoke("move_kanban_card", { request: { ...request, author: writeAuthor() } });
}

// A task or card with the state other devices need to merge it, to send after a local change
export function exportTaskRecord(path: string, id: string): Promise<Task | null> {
	return invoke("export_task_record", { path, id });
}
export function exportCardRecord(path: string, id: string): Promise<KanbanCard | null> {
	return invoke("export_card_record", { path, id });
}

// Merge a task or card a collaborator sent, field by field; resolves to whether anything here changed
export function mergeTaskRecord(path: string, task: Task): Promise<boolean> {
	return invoke("merge_task_record", { path, task });
}
export function mergeCardRecord(path: string, card: KanbanCard): Promise<boolean> {
	return invoke("merge_card_record", { path, card });
}

// Settle a conflict by choosing a value for the field; resolves to the record as it now reads
export function resolveTaskConflict(path: string, id: string, field: string, value: unknown): Promise<Task | null> {
	return invoke("resolve_task_conflict", { path, id, field, value, author: writeAuthor() });
}
export function resolveCardConflict(path: string, id: string, field: string, value: unknown): Promise<KanbanCard | null> {
	return invoke("resolve_card_conflict", { path, id, field, value, author: writeAuthor() });
}

// What other people changed since the person last looked, for the catch-up review
export function getCatchup(path: string): Promise<CatchupEntry[]> {
	return invoke("get_catchup", { path });
}
export function markCatchup(path: string, ids: number[], state: "seen" | "reverted"): Promise<void> {
	return invoke("mark_catchup", { path, ids, state });
}
export function addTextCatchup(path: string, docId: string, label: string, who: string | null, before: string, after: string, live = false): Promise<void> {
	return invoke("add_text_catchup", { path, docId, label, who, before, after, live });
}

// Rules about whole records (a finished task has an assignee), which a workspace can turn on
export function getRules(path: string): Promise<RuleInfo[]> {
	return invoke("get_rules", { path });
}
export function setRule(path: string, id: string, enabled: boolean): Promise<void> {
	return invoke("set_rule", { path, id, enabled });
}

// Drafts: change a copy of one task or card, review what merging it would do, then merge. A draft stays on this device.
export function listDrafts(path: string, entity: "task" | "card", target: string): Promise<Draft[]> {
	return invoke("list_drafts", { path, entity, target });
}
export function startDraft(path: string, entity: "task" | "card", target: string, name: string): Promise<Draft> {
	return invoke("start_draft", { path, entity, target, name, author: writeAuthor() });
}
export function getDraft<T extends Task | KanbanCard>(path: string, draftId: string): Promise<T> {
	return invoke("get_draft", { path, draftId });
}
export function saveDraft<T extends Task | KanbanCard>(path: string, draftId: string, record: T): Promise<T> {
	return invoke("save_draft", { path, draftId, record, author: writeAuthor() });
}
export function previewDraft(path: string, draftId: string): Promise<DraftPreview> {
	return invoke("preview_draft", { path, draftId });
}
// Resolves to the record with the state other devices need to merge it, to send on like any other edit
export function mergeDraft<T extends Task | KanbanCard>(path: string, draftId: string): Promise<T> {
	return invoke("merge_draft", { path, draftId });
}
export function discardDraft(path: string, draftId: string): Promise<void> {
	return invoke("discard_draft", { path, draftId });
}

// Drafts of a whole board: move cards around privately, review what that would change, then merge them all or none
export function listBoardDrafts(path: string): Promise<BoardDraft[]> {
	return invoke("list_board_drafts", { path });
}
export function startBoardDraft(path: string, name: string): Promise<BoardDraft> {
	return invoke("start_board_draft", { path, name, author: writeAuthor() });
}
// The board as the draft would leave it
export function getBoardDraft(path: string, boardId: string): Promise<KanbanColumn[]> {
	return invoke("get_board_draft", { path, boardId });
}
export function moveInBoardDraft(path: string, boardId: string, cardId: string, columnId: string, position: number): Promise<void> {
	return invoke("move_in_board_draft", { path, boardId, cardId, columnId, position, author: writeAuthor() });
}
export function previewBoardDraft(path: string, boardId: string): Promise<BoardPreview> {
	return invoke("preview_board_draft", { path, boardId });
}
// Resolves to the ids of the cards that were changed, to send on like any other edit
export function mergeBoardDraft(path: string, boardId: string): Promise<string[]> {
	return invoke("merge_board_draft", { path, boardId });
}
export function discardBoardDraft(path: string, boardId: string): Promise<void> {
	return invoke("discard_board_draft", { path, boardId });
}

// Delete a kanban column and its cards
export function deleteKanbanColumn(request: TaskIdRequest): Promise<void> {
	return invoke("delete_kanban_column", { request });
}

// Delete a single kanban card
export function deleteKanbanCard(request: TaskIdRequest): Promise<void> {
	return invoke("delete_kanban_card", { request });
}

// ────────────────────────────
// Filesystem & Dashboard
// ────────────────────────────

// List files in a workspace content subdirectory
export function listWorkspaceFiles(
	path: string,
	subdir: string,
): Promise<WorkspaceFile[]> {
	return invoke("list_workspace_files", { path, subdir });
}

// Every file in the workspace with the lower-cased text of small text files, in one call
export function searchWorkspaceFiles(path: string, withOffice = false): Promise<{ name: string; path: string; size: number; body: string }[]> {
	return invoke("search_workspace_files", { path, withOffice });
}

// Create a new empty file in workspace
export async function createWorkspaceFile(
	path: string,
	relPath: string,
	name: string,
): Promise<void> {
	await invoke("create_workspace_item", {
		path,
		relPath,
		name,
		isDir: false,
	});
	// A new file starts empty, even if a file of the same name once had live editing state
	await forgetYjsDocs(path, `${relPath.replace(/^\/+|\/+$/g, "")}/${name}`);
}

// Create a new folder in workspace
export function createWorkspaceFolder(
	path: string,
	relPath: string,
	name: string,
): Promise<void> {
	return invoke("create_workspace_item", {
		path,
		relPath,
		name,
		isDir: true,
	});
}

// Read text contents from workspace file
export function readWorkspaceFile(
	path: string,
	relPath: string,
): Promise<string> {
	return invoke("read_workspace_file", { path, relPath });
}

// Write text contents to workspace file
export function writeWorkspaceFile(
	path: string,
	relPath: string,
	content: string,
): Promise<void> {
	return invoke("write_workspace_file", { path, relPath, content });
}

// Read binary file from workspace as base64 string
export function readWorkspaceBinaryFile(
	path: string,
	relPath: string,
): Promise<string> {
	return invoke("read_workspace_binary_file", { path, relPath });
}

// Write binary base64 data to workspace file
export function writeWorkspaceBinaryFile(
	path: string,
	relPath: string,
	base64Data: string,
): Promise<void> {
	return invoke("write_workspace_binary_file", { path, relPath, base64Data });
}

// Import an external asset file from disk into workspace assets/
export function importAssetFromPath(
	workspacePath: string,
	sourcePath: string,
): Promise<WorkspaceFile> {
	return invoke("import_asset_from_path", { workspacePath, sourcePath });
}

// Delete a workspace file or directory permanently
export async function deleteWorkspaceItem(
	path: string,
	relPath: string,
): Promise<void> {
	await invoke("delete_workspace_item", { path, relPath });
	forgetRecent(path, relPath);
	// The live editing state goes with the file, or a new file of the same name would open with the old text
	await forgetYjsDocs(path, relPath.replace(/^\/+|\/+$/g, ""));
}

// Removes the stored editing state of a file, or of every file inside a folder
async function forgetYjsDocs(workspacePath: string, rel: string): Promise<void> {
	try {
		const ids = (await listYjsDocs(workspacePath)) ?? [];
		await Promise.all(ids.filter((id) => id === rel || id.startsWith(`${rel}/`)).map((id) => deleteYjsDoc(workspacePath, id)));
	} catch {
		// The file itself is already created or deleted; stale state is only a nuisance
	}
}

// Rename a workspace file or directory
export async function renameWorkspaceItem(
	path: string,
	relPath: string,
	newName: string,
): Promise<void> {
	await invoke("rename_workspace_item", { path, relPath, newName });
	renameRecent(path, relPath, newName);
}

// Get aggregate stats for workspace dashboard
export function getWorkspaceStats(path: string): Promise<WorkspaceStats> {
	return invoke("get_workspace_stats", { path });
}

// ────────────────────────────
// Recent workspaces registry
// ────────────────────────────

// Get list of recent workspaces from app registry
export function getRecentWorkspaces(): Promise<WorkspaceInfo[]> {
	return invoke<WorkspaceInfo[]>("get_recent_workspaces").then((list) => list.map(tidy));
}

// Add workspace to recent workspaces list
export function addRecentWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return invoke("add_recent_workspace", { workspace });
}

// Remove workspace from recent list
export function removeRecentWorkspace(id: string): Promise<void> {
	return invoke("remove_recent_workspace", { id });
}

// ────────────────────────────
// Last workspace (session restoration)
// ────────────────────────────

// Get last opened workspace for automatic restoration
export function getLastWorkspace(): Promise<WorkspaceInfo | null> {
	return invoke<WorkspaceInfo | null>("get_last_workspace").then((w) => (w ? tidy(w) : w));
}

// Persist last opened workspace
export function setLastWorkspace(workspace: WorkspaceInfo): Promise<void> {
	return invoke("set_last_workspace", { workspace });
}

// Clear last workspace tracking
export function clearLastWorkspace(): Promise<void> {
	return invoke("clear_last_workspace");
}

// ────────────────────────────
// Security & App Configuration
// ────────────────────────────

// Load application security configuration
export function loadConfig(): Promise<NexsyncConfig> {
	return invoke<NexsyncConfig>("load_config_cmd").then((c) => ({ ...c, allowed_workspace_roots: (c.allowed_workspace_roots ?? []).map(cleanPath) }));
}

// Save application security configuration
export function saveConfig(config: NexsyncConfig): Promise<void> {
	return invoke("save_config_cmd", { config });
}

// Check if a directory path is valid and allowed
export function validateAllowedRoot(workspacePath: string): Promise<boolean> {
	return invoke("validate_allowed_root_cmd", { workspacePath });
}

// ────────────────────────────
// Yjs CRDT Binary Persistence
// ────────────────────────────

// Convert Uint8Array to base64 string for IPC transmission
export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = "";
	const len = bytes.byteLength;
	const chunkSize = 0x8000;
	for (let i = 0; i < len; i += chunkSize) {
		const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
		binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
	}
	return btoa(binary);
}

// Convert base64 string from IPC transmission to Uint8Array
export function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// Retrieve stored Yjs CRDT document binary state from SQLite
export async function getYjsDoc(
	workspacePath: string,
	docId: string,
): Promise<Uint8Array | null> {
	// The bytes come back as they are (no base64, no JSON): a document's state runs to megabytes
	const raw = await invoke<ArrayBuffer | Uint8Array | number[] | null>("get_yjs_doc_raw", { workspacePath, docId });
	if (!raw) return null;
	const bytes = raw instanceof Uint8Array ? raw : raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw);
	return bytes.byteLength > 0 ? bytes : null;
}

// Ids of every document that has stored CRDT state
export function listYjsDocs(workspacePath: string): Promise<string[]> {
	return invoke("list_yjs_docs", { workspacePath });
}

// Persist Yjs CRDT document binary state into SQLite
export async function saveYjsDoc(
	workspacePath: string,
	docId: string,
	state: Uint8Array,
): Promise<void> {
	// Sent as the request's body, the bytes as they are; which document it is goes in headers
	await invoke("save_yjs_doc_raw", state, { headers: { "x-workspace": encodeURIComponent(workspacePath), "x-doc": encodeURIComponent(docId) } });
}

// Move a Yjs document's binary CRDT state to a new doc id, e.g. after a file rename
export function renameYjsDoc(
	workspacePath: string,
	oldDocId: string,
	newDocId: string,
): Promise<void> {
	return invoke("rename_yjs_doc", {
		workspacePath,
		oldDocId,
		newDocId,
	});
}

// Delete Yjs CRDT document binary state from SQLite
export function deleteYjsDoc(
	workspacePath: string,
	docId: string,
): Promise<void> {
	return invoke("delete_yjs_doc", {
		workspacePath,
		docId,
	});
}

// ────────────────────────────
// Editor: run output and system files
// ────────────────────────────

// One line of output from a command started with runCommand
export interface RunOutput {
	runId: string;
	stream: "stdout" | "stderr";
	text: string;
}

export interface RunExit {
	runId: string;
	code: number | null;
	stopped: boolean;
	error: string | null;
}

// Start a command inside a folder of the editor area; output arrives through onRunOutput
export function runCommand(workspacePath: string, dir: string, command: string): Promise<string> {
	return invoke("run_command", { workspacePath, dir, command });
}

export function killRun(runId: string): Promise<void> {
	return invoke("kill_run", { runId });
}

export const onRunOutput = (handler: (event: RunOutput) => void) =>
	listen<RunOutput>("editor://run-output", (e) => handler(e.payload));

export const onRunExit = (handler: (event: RunExit) => void) =>
	listen<RunExit>("editor://run-exit", (e) => handler(e.payload));

// ────────────────────────────
// Terminals: real shells in the Editor's bottom panel
// ────────────────────────────

export interface TerminalData {
	id: string;
	// Base64 of the raw bytes the shell printed
	data: string;
}

export interface TerminalExit {
	id: string;
	code: number | null;
}

// Open a shell in a folder of the editor area; what it prints arrives through onTerminalData
export function openTerminal(workspacePath: string, dir: string, cols: number, rows: number, shell?: string): Promise<string> {
	return invoke("terminal_open", { workspacePath, dir, cols, rows, shell: shell ?? null });
}

// The shells installed on this device (PowerShell, cmd, bash, ...), the default first
export interface TerminalShell {
	id: string;
	name: string;
	path: string;
}
export function listTerminalShells(): Promise<TerminalShell[]> {
	return invoke("terminal_shells");
}

export function writeTerminal(id: string, data: string): Promise<void> {
	return invoke("terminal_write", { id, data });
}

export function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
	return invoke("terminal_resize", { id, cols, rows });
}

export function closeTerminal(id: string): Promise<void> {
	return invoke("terminal_close", { id });
}

export const onTerminalData = (handler: (event: TerminalData) => void) =>
	listen<TerminalData>("terminal://data", (e) => handler(e.payload));

export const onTerminalExit = (handler: (event: TerminalExit) => void) =>
	listen<TerminalExit>("terminal://exit", (e) => handler(e.payload));

// Open a workspace file, such as a Word document, in the default app for its type
export function openWorkspaceFile(workspacePath: string, relPath: string): Promise<void> {
	return invoke("open_workspace_file", { workspacePath, relPath });
}

// ────────────────────────────
// Version history and export
// ────────────────────────────

// The saved versions of a file, newest first
export function listFileVersions(path: string, relPath: string): Promise<FileVersion[]> {
	return invoke("list_file_versions", { path, relPath });
}

// Keep the text an editor holds now as a version: a periodic snapshot, or a named one
export function recordFileVersion(
	path: string,
	relPath: string,
	content: string,
	options: { label?: string; author?: string } = {},
): Promise<void> {
	return invoke("record_file_version", {
		path,
		relPath,
		content,
		source: options.label ? "named" : "auto",
		label: options.label ?? null,
		author: options.author ?? null,
	});
}

// Keep a version a collaborator named, if this device has the file; resolves to whether it was added
export function receiveNamedVersion(
	path: string,
	relPath: string,
	content: string,
	label: string,
	author: string,
): Promise<boolean> {
	return invoke("receive_named_version", { path, relPath, content, label, author });
}

// A version read as text, for the preview and the diff
export function readFileVersion(path: string, id: number): Promise<string> {
	return invoke("read_file_version", { path, id });
}

// Put a version back on disk (what was there is kept as a version first); returns the file's path
export function restoreFileVersion(path: string, id: number): Promise<string> {
	return invoke("restore_file_version", { path, id });
}

// Zip workspace folders to a path chosen in the save dialog; returns how many files went in
export function exportZip(path: string, roots: string[], dest: string): Promise<number> {
	return invoke("export_zip", { path, roots, dest });
}

// Save a finished export, such as a note as Markdown or PDF, to a path chosen in the save dialog
export function writeExportFile(path: string, dest: string, contentBase64: string): Promise<void> {
	return invoke("write_export_file", { path, dest, contentBase64 });
}

// ── Projects ──
export function projectsList(path: string): Promise<ProjectInfo[]> {
	return invoke("projects_list", { path });
}
export function projectSaveRecipe(path: string, project: string, recipe: Recipe): Promise<Recipe> {
	return invoke("project_save_recipe", { path, project, recipe });
}
export function projectCreate(path: string, name: string): Promise<string> {
	return invoke("project_create", { path, name });
}
export function projectAddIgnore(path: string, project: string, line: string): Promise<void> {
	return invoke("project_add_ignore", { path, project, line });
}
// `wsl` asks inside that Windows Subsystem for Linux distribution instead of on this system
export function projectDoctor(path: string, tools: ToolReq[], wsl?: string | null): Promise<Doctor> {
	return invoke("project_doctor", { path, tools, wsl: wsl ?? null });
}
export function projectContainers(path: string, project: string): Promise<Containers> {
	return invoke("project_containers", { path, project });
}
// Opens a document file of the workspace (.docx, .odt, .rtf, .md, .html, .txt) as HTML for the editor, with what it holds
export function officeImport(path: string, rel: string, password?: string | null): Promise<ImportAnswer> {
	return invoke("office_import", { path, rel, password: password ?? null });
}
// Writes the editor's HTML as the file `dest` names (.docx, .odt, .rtf, .md, .html, .txt, .tex); `author` empty leaves the file unnamed
export function officeExport(path: string, dest: string, html: string, title: string, author: string, layout?: OfficeLayout | null, sourceId?: string | null): Promise<number> {
	return invoke("office_export", { path, dest, html, title, author, layout: layout ?? null, sourceId: sourceId ?? null });
}
export function officeInspect(path: string, rel: string): Promise<OfficeInspect> {
	return invoke("office_inspect", { path, rel });
}
// What each cell of a workbook shows, worked out by the spreadsheet engine from what was typed
export function sheetCalculate(sheets: SheetIn[]): Promise<{ sheets: SheetOut[]; truncated: boolean; refused: [string, string, string][] }> {
	return invoke("sheet_calculate", { sheets });
}
// Inserts or deletes rows or columns (at is 0-based); the engine rewrites the formulas that point at moved cells
export function sheetRestructure(sheets: SheetIn[], sheet: string, op: "insertRows" | "deleteRows" | "insertCols" | "deleteCols", at: number, count: number): Promise<SheetIn[]> {
	return invoke("sheet_restructure", { sheets, sheet, op, at, count });
}
export function sheetOpen(path: string, rel: string): Promise<{ sheets: SheetIn[]; notes: string[] }> {
	return invoke("sheet_open", { path, rel });
}
// Saves the workbook as .xlsx, or the named sheet as .csv or .tsv
export function sheetSave(path: string, dest: string, sheets: SheetIn[], sheet: string): Promise<number> {
	return invoke("sheet_save", { path, dest, sheets, sheet });
}
// Sorts the rows of a range by one column, keeping each row's looks with it
export function sheetSort(sheets: SheetIn[], sheet: string, range: string, column: string, descending: boolean, header: boolean): Promise<SheetIn[]> {
	return invoke("sheet_sort", { sheets, sheet, range, column, descending, header });
}
// A chart of a range, as shapes and text to paint
export function sheetChart(sheets: SheetIn[], sheet: string, spec: { range: string; kind: string; title: string; w: number; h: number; opts?: object }): Promise<ChartPrim[]> {
	return invoke("sheet_chart", { sheets, sheet, spec });
}
// Slide decks: the pieces of a deck from a file, a slide drawn as a picture, and the small edits the slide editor makes
export interface DeckParts {
	base: string;
	slides: string[];
}
export interface DeckRendered {
	png: string;
	widthPt: number;
	heightPt: number;
	frames: Frame[];
}
export function deckNew(): Promise<{ parts: DeckParts; notes: string[] }> {
	return invoke("deck_new");
}
export function deckOpen(path: string, rel: string): Promise<{ parts: DeckParts; notes: string[] }> {
	return invoke("deck_open", { path, rel });
}
// Keeps the deck's base on the backend for drawing; returns its id
export function deckRegister(base: string): Promise<string> {
	return invoke("deck_register", { base });
}
export function deckRender(baseId: string, slide: string, scale: number): Promise<DeckRendered> {
	return invoke("deck_render", { baseId, slide, scale });
}
export function deckLayouts(baseId: string): Promise<{ id: number; name: string }[]> {
	return invoke("deck_layouts", { baseId });
}
export function deckNewSlide(baseId: string, layout: number): Promise<string> {
	return invoke("deck_new_slide", { baseId, layout });
}
export function deckNewShape(kind: string, id: number, x: number, y: number, w: number, h: number): Promise<string> {
	return invoke("deck_new_shape", { kind, id, x, y, w, h });
}
export interface ShapeEdit {
	text?: string;
	// RRGGBB, or "" for no fill
	fill?: string;
	bold?: boolean;
	italic?: boolean;
	size?: number;
	color?: string;
	x?: number;
	y?: number;
	w?: number;
	h?: number;
	rot?: number;
	underline?: boolean;
	font?: string;
	align?: "left" | "center" | "right" | "justify";
	// The outline: RRGGBB, or "" for none
	line?: string;
	lineWidth?: number;
}
// The settings of a slide that are not its shapes
export interface SlideEdit {
	notes?: string;
	transition?: string;
	hidden?: boolean;
	// RRGGBB, or "" to follow the layout
	background?: string;
}
export function deckEditSlide(slide: string, edit: SlideEdit): Promise<string> {
	return invoke("deck_edit_slide", { slide, edit });
}
// A picture for the deck: the new base that holds it, and the picture shape for a slide
export function deckAddPicture(base: string, name: string, data: string, id: number, x: number, y: number, w: number, h: number): Promise<[string, string]> {
	return invoke("deck_add_picture", { base, name, data, id, x, y, w, h });
}
export function deckEditShape(shape: string, edit: ShapeEdit): Promise<string> {
	return invoke("deck_edit_shape", { shape, edit });
}
export function deckSave(path: string, dest: string, base: string, slides: string[]): Promise<number> {
	return invoke("deck_save", { path, dest, base, slides });
}
export function lspStatus(path: string, project: string): Promise<LspStatus> {
	return invoke("lsp_status", { path, project });
}
export function lspEnable(path: string, project: string, on: boolean): Promise<void> {
	return invoke("lsp_enable", { path, project, on });
}
// Tells the language server the text of an open file; returns its name, or null when none handles the file
export function lspSync(path: string, project: string, rel: string, text: string, version: number): Promise<string | null> {
	return invoke("lsp_sync", { path, project, rel, text, version });
}
export function lspClose(path: string, project: string, rel: string): Promise<void> {
	return invoke("lsp_close", { path, project, rel });
}
export function lspRequest<T = unknown>(path: string, project: string, rel: string, method: string, params: unknown): Promise<T> {
	return invoke("lsp_request", { path, project, rel, method, params });
}
export function projectRuntime(path: string, project: string): Promise<RuntimeInfo> {
	return invoke("project_runtime", { path, project });
}
export function projectRuntimeSet(path: string, project: string, wsl: string | null): Promise<void> {
	return invoke("project_runtime_set", { path, project, wsl });
}
export function projectScan(path: string): Promise<Scan> {
	return invoke("project_scan", { path });
}
export function projectTaskTrust(path: string, project: string, taskId: string): Promise<Trust> {
	return invoke("project_task_trust", { path, project, taskId });
}
export function projectTaskApprove(path: string, project: string, taskId: string): Promise<void> {
	return invoke("project_task_approve", { path, project, taskId });
}
// Starts a task; `once` says the person just chose Run Once for this command
// `args` are added after the approved command, each in quotes (a test's name, to run just that test)
export function projectTaskStart(path: string, project: string, taskId: string, once: boolean, args?: string[]): Promise<string> {
	return invoke("project_task_start", { path, project, taskId, once, args: args ?? null });
}
// Known-vulnerable and out-of-date packages; contacts the package registries, so only when asked
export function projectAudit(path: string, project: string): Promise<Audit[]> {
	return invoke("project_audit", { path, project });
}
export function projectGenerators(path: string, project: string): Promise<GeneratorList> {
	return invoke("project_generators", { path, project });
}
// The files a generator would write for these values (`dryRun`), or writes them; nothing is written if one exists
export function projectGenerate(path: string, project: string, generator: string, values: Record<string, string>, dryRun: boolean): Promise<Planned[]> {
	return invoke("project_generate", { path, project, generator, values, dryRun });
}
// The test files that changes since `since` (milliseconds; 0 for none known) can reach
export function projectTestImpact(path: string, project: string, since: number): Promise<Impact> {
	return invoke("project_test_impact", { path, project, since });
}
// Puts the edits since the last pass (`since`, milliseconds) back one at a time in a copy and runs the task to find the one that broke it
export function projectBisect(path: string, project: string, taskId: string, since: number): Promise<Bisected> {
	return invoke("project_bisect", { path, project, taskId, since });
}
export function projectBisectCancel(): Promise<void> {
	return invoke("project_bisect_cancel");
}
export function projectSearch(path: string, project: string, query: string, regex: boolean, caseSensitive: boolean): Promise<Found> {
	return invoke("project_search", { path, project, query, regex, caseSensitive });
}
// Replaces in the files named (from a search); returns how many replacements were made
export function projectReplace(path: string, project: string, query: string, regex: boolean, caseSensitive: boolean, replacement: string, files: string[]): Promise<number> {
	return invoke("project_replace", { path, project, query, regex, caseSensitive, replacement, files });
}
export function projectHttpFiles(path: string, project: string): Promise<HttpFile[]> {
	return invoke("project_http_files", { path, project });
}
// Sends request number `index` of a .http file, with the variables of one environment (empty for none)
export function projectHttpSend(path: string, project: string, file: string, index: number, env: string): Promise<HttpResponse> {
	return invoke("project_http_send", { path, project, file, index, env });
}
export function projectReports(path: string, project: string): Promise<ReportFile[]> {
	return invoke("project_reports", { path, project });
}
export function projectReadReport(path: string, project: string, file: string): Promise<string> {
	return invoke("project_read_report", { path, project, file });
}
export function projectSecretAllow(path: string, relPath: string): Promise<void> {
	return invoke("project_secret_allow", { path, relPath });
}
export function projectTemplates(): Promise<Template[]> {
	return invoke("project_templates");
}
export function projectScaffoldPreview(template: string, name: string, options: [string, string][]): Promise<string> {
	return invoke("project_scaffold_preview", { template, name, options });
}
// Runs a template in the projects folder; the output streams under the new project's name
export function projectScaffold(path: string, template: string, name: string, options: [string, string][]): Promise<string> {
	return invoke("project_scaffold", { path, template, name, options });
}
export function projectImportPreview(path: string, source: string): Promise<ImportPreview> {
	return invoke("project_import_preview", { path, source });
}
export function projectImport(path: string, source: string, name: string, skipKept: boolean): Promise<number> {
	return invoke("project_import", { path, source, name, skipKept });
}
export function projectTaskStop(runId: string): Promise<void> {
	return invoke("project_task_stop", { runId });
}
export function projectRuns(path: string, project: string): Promise<RunRecord[]> {
	return invoke("project_runs", { path, project });
}
export function projectRunLog(path: string, runId: string): Promise<string> {
	return invoke("project_run_log", { path, runId });
}
export function projectEnvStatus(path: string, project: string): Promise<EnvState[]> {
	return invoke("project_env_status", { path, project });
}
export function projectEnvSet(path: string, project: string, name: string, value: string, store: "file" | "credential"): Promise<void> {
	return invoke("project_env_set", { path, project, name, value, store });
}
export function projectEnvClear(path: string, project: string, name: string): Promise<void> {
	return invoke("project_env_clear", { path, project, name });
}
export function projectDepsStatus(path: string, project: string): Promise<DepsStatus> {
	return invoke("project_deps_status", { path, project });
}
export function projectDepsMark(path: string, project: string): Promise<void> {
	return invoke("project_deps_mark", { path, project });
}
// Pauses or resumes changes other devices make inside projects/; returns how many are waiting
export function p2pHoldIncoming(hold: boolean): Promise<number> {
	return invoke("p2p_hold_incoming", { hold });
}
export function p2pHeldCount(): Promise<[boolean, number]> {
	return invoke("p2p_held_count");
}
// Saves plain text to a path chosen in the save dialog
export function writeExportText(path: string, dest: string, text: string): Promise<void> {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return writeExportFile(path, dest, btoa(binary));
}

// Spelling and grammar of a text: each distinct problem once, with what to write instead
export interface ProofProblem {
	text: string;
	kind: "spelling" | "grammar";
	message: string;
	suggestions: string[];
}
export function proofCheck(text: string): Promise<ProofProblem[]> {
	return invoke("proof_check", { text });
}

// A document's pages as pictures, laid out and drawn by the word-processor engine (for Print Layout)
export interface PageImage {
	png: string;
	widthPt: number;
	heightPt: number;
	// Where the text goes on the page: between the margins, less what a header or footer reaches into them
	bodyTopPt: number;
	bodyHeightPt: number;
}
export function officeRender(html: string, title: string, layout: OfficeLayout | null, scale: number, sourceId?: string | null): Promise<PageImage[]> {
	return invoke("office_render", { html, title, layout, scale, sourceId: sourceId ?? null });
}

// A document laid out once (the slow part), kept on the backend under a session id; its pages are then drawn one at a time as they scroll into view
export interface PageList {
	session: number;
	sizes: [number, number][];
}
export function officeLayout(html: string, title: string, layout: OfficeLayout | null, sourceId?: string | null): Promise<PageList> {
	return invoke("office_layout", { html, title, layout, sourceId: sourceId ?? null });
}
export function officePage(session: number, index: number, scale: number): Promise<PageImage> {
	return invoke("office_page", { session, index, scale });
}
// Page `index` of a document the editor shows on `pages` pages, with only the header and footer of the file it came from drawn on it
export function officeMargins(sourceId: string, pages: number, index: number, scale: number): Promise<PageImage> {
	return invoke("office_margins", { sourceId, pages, index, scale });
}
