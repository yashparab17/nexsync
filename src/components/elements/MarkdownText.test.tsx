import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MarkdownText from "./MarkdownText";

describe("MarkdownText", () => {
	it("shows bold, lists and code as elements", () => {
		const { container } = render(<MarkdownText text={"**Big** news\n\n- one\n- two\n\n`code`"} />);
		expect(container.querySelector("strong")?.textContent).toBe("Big");
		expect(container.querySelectorAll("li")).toHaveLength(2);
		expect(container.querySelector("code")?.textContent).toBe("code");
	});

	it("never becomes markup: HTML and links stay text, nothing is clickable", () => {
		const { container } = render(<MarkdownText text={'<img src=x onerror="alert(1)"> <script>alert(2)</script> [site](https://example.com)'} />);
		expect(container.querySelector("img, script, a")).toBeNull();
		expect(container.textContent).toContain("https://example.com");
		expect(container.textContent).toContain("<script>");
	});
});
