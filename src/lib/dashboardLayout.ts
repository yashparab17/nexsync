// Which dashboard tiles show, in what order and at what size. Remembered per workspace on this device.

export const TILE_IDS = ["pickup", "tasks", "files", "due", "people", "activity", "cards", "projects"] as const;
export type TileId = (typeof TILE_IDS)[number];
export type TileSize = "s" | "m" | "l";

export interface DashboardLayout {
	order: TileId[];
	size: Record<TileId, TileSize>;
	hidden: TileId[];
}

export const DEFAULT_LAYOUT: DashboardLayout = {
	order: [...TILE_IDS],
	size: { pickup: "m", tasks: "s", files: "s", due: "s", people: "s", activity: "m", cards: "s", projects: "s" },
	hidden: [],
};

const key = (workspaceId: string) => `nexsync-dashboard:${workspaceId}`;

// Anything stored that does not fit (older versions, edits by hand) falls back to the default for that part
export function parseLayout(raw: unknown): DashboardLayout {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DashboardLayout>;
	const known = (id: unknown): id is TileId => TILE_IDS.includes(id as TileId);
	const order = Array.isArray(r.order) ? [...new Set(r.order.filter(known))] : [];
	for (const id of TILE_IDS) if (!order.includes(id)) order.push(id);
	const size = { ...DEFAULT_LAYOUT.size };
	for (const id of TILE_IDS) {
		const s = r.size?.[id];
		if (s === "s" || s === "m" || s === "l") size[id] = s;
	}
	return { order, size, hidden: Array.isArray(r.hidden) ? [...new Set(r.hidden.filter(known))] : [] };
}

export function loadLayout(workspaceId: string): DashboardLayout {
	try {
		return parseLayout(JSON.parse(localStorage.getItem(key(workspaceId)) ?? "null"));
	} catch {
		return parseLayout(null);
	}
}

export function saveLayout(workspaceId: string, layout: DashboardLayout) {
	try {
		localStorage.setItem(key(workspaceId), JSON.stringify(layout));
	} catch {
		// Not remembered this time
	}
}

// `id` takes the place of `target` in the order
export function moveTile(order: TileId[], id: TileId, target: TileId): TileId[] {
	if (id === target) return order;
	const next = order.filter((t) => t !== id);
	next.splice(order.indexOf(target), 0, id);
	return next;
}
