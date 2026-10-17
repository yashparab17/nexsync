import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useListKeys } from "@/hooks/useListKeys";

function Page({ onNew }: { onNew: () => void }) {
	useListKeys(onNew);
	return (
		<>
			<input type="search" aria-label="s" />
			<button data-nav>one</button>
			<button data-nav>two</button>
			<textarea aria-label="t" />
		</>
	);
}
const press = (key: string, target: Element | Window = window) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

afterEach(cleanup);

describe("useListKeys", () => {
	it("moves between rows, makes a new one and finds the search box", () => {
		const onNew = vi.fn();
		const { getByText, getByLabelText } = render(<Page onNew={onNew} />);
		press("j");
		expect(document.activeElement).toBe(getByText("one"));
		press("j");
		expect(document.activeElement).toBe(getByText("two"));
		press("k");
		expect(document.activeElement).toBe(getByText("one"));
		press("n");
		expect(onNew).toHaveBeenCalledTimes(1);
		press("/");
		expect(document.activeElement).toBe(getByLabelText("s"));
	});
	it("leaves keys alone while typing", () => {
		const onNew = vi.fn();
		const { getByLabelText } = render(<Page onNew={onNew} />);
		press("n", getByLabelText("t"));
		expect(onNew).not.toHaveBeenCalled();
	});
});
