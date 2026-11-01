import { useCallback, useState } from "react";

// Copies text to the clipboard and tracks which `key` was last copied for `resetDelay` ms
export function useCopyToClipboard(resetDelay = 2000) {
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	const copy = useCallback(
		(text: string, key = "copied") => {
			// Said to be copied only once it was: a write the window refuses must not look like a success
			const done = () => {
				setCopiedKey(key);
				setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), resetDelay);
			};
			navigator.clipboard.writeText(text).then(done, () => {
				// The clipboard API is not allowed here: fall back to the older way, which a click can always use
				const box = document.createElement("textarea");
				box.value = text;
				box.style.position = "fixed";
				box.style.opacity = "0";
				document.body.append(box);
				box.select();
				try {
					if (document.execCommand("copy")) done();
				} finally {
					box.remove();
				}
			});
		},
		[resetDelay],
	);

	return { copiedKey, copy };
}
