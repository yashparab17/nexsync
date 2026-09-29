import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

// Runs onOpen once with the `?open=` value (set by workspace search) when `ready`, then clears it
export function useOpenParam(onOpen: (value: string) => void, ready = true) {
	const [params, setParams] = useSearchParams();
	const value = params.get("open");
	const cb = useRef(onOpen);
	cb.current = onOpen;

	useEffect(() => {
		if (!value || !ready) return;
		cb.current(value);
		setParams({}, { replace: true });
	}, [value, ready, setParams]);
}
