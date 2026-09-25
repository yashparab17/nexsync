import { useEffect, useRef, type DependencyList } from "react";

// Runs `seed` exactly once, the first time `ready` becomes true. Used to seed a
// collaborative Yjs document from on-disk content the first time it's ever opened.
export function useSeedOnce(ready: boolean, seed: () => void, deps: DependencyList) {
	const seededRef = useRef(false);
	useEffect(() => {
		if (!ready || seededRef.current) return;
		seededRef.current = true;
		seed();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}
