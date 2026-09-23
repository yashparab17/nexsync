import { useCallback, useState } from "react";

// Copies text to the clipboard and tracks which `key` was last copied for `resetDelay` ms
export function useCopyToClipboard(resetDelay = 2000) {
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	const copy = useCallback(
		(text: string, key = "copied") => {
			navigator.clipboard.writeText(text);
			setCopiedKey(key);
			setTimeout(() => {
				setCopiedKey((current) => (current === key ? null : current));
			}, resetDelay);
		},
		[resetDelay],
	);

	return { copiedKey, copy };
}
