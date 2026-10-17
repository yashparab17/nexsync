import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

// Runs onNew once when the page was opened with `?new=1` (the sidebar's New menu), then clears it
export function useNewParam(onNew: () => void, ready = true) {
	const [params, setParams] = useSearchParams();
	const wanted = params.has("new");
	const cb = useRef(onNew);
	cb.current = onNew;
	useEffect(() => {
		if (!wanted || !ready) return;
		cb.current();
		setParams({}, { replace: true });
	}, [wanted, ready, setParams]);
}
