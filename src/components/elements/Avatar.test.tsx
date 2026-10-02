import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import Avatar, { initialOf } from "./Avatar";

afterEach(cleanup);

const look = (name: string) => {
	const { container } = render(<Avatar name={name} />);
	const el = container.querySelector("[data-slot=avatar]") as HTMLElement;
	return { letter: el.textContent, style: el.getAttribute("style") };
};

describe("Avatar", () => {
	it("is one letter, and the same one on every page: Yash is a Y, not YA", () => {
		expect(look("Yash").letter).toBe("Y");
	});

	it("has the same colour for the same name and a different one for another name", () => {
		expect(look("Yash").style).toBe(look("Yash").style);
		expect(look("Yash").style).not.toBe(look("Sam").style);
	});

	it("takes the first letter, ignoring spaces and case, and has a fallback for no name", () => {
		expect(initialOf("  yash ")).toBe("Y");
		expect(initialOf("")).toBe("C");
		expect(look("  ").letter).toBe("C");
	});
});
