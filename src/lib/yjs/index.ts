// Barrel export for Yjs persistence and collaboration utilities

import * as Y from "yjs";
export { Y };
export * from "yjs";

export {
	SqlitePersistenceProvider,
	type SqlitePersistenceOptions,
} from "./SqlitePersistenceProvider";
