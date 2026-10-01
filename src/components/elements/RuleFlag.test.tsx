import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ConflictPanel from "./ConflictPanel";
import RuleFlag from "./RuleFlag";

afterEach(cleanup);

const broken = [{ rule: "finished-has-owner", message: "It is finished, but nobody is assigned." }];

describe("rule flags", () => {
	it("marks a record that breaks a rule, and says why to a screen reader", () => {
		render(<RuleFlag violations={broken} />);
		expect(screen.getByText("Needs attention", { exact: false })).toBeTruthy();
		expect(screen.getByText(/nobody is assigned/)).toBeTruthy();
	});

	it("shows nothing for a record that breaks none", () => {
		const { container, rerender } = render(<RuleFlag violations={[]} />);
		expect(container.textContent).toBe("");
		rerender(<RuleFlag />);
		expect(container.textContent).toBe("");
	});

	it("explains a broken rule in the panel, with nothing to choose between", () => {
		render(<ConflictPanel conflicts={[]} violations={broken} show={String} canChoose onChoose={() => {}} />);
		expect(screen.getByRole("region", { name: "Rules this breaks" }).textContent).toContain("nobody is assigned");
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("stays out of the way when there is nothing to show", () => {
		const { container } = render(<ConflictPanel conflicts={[]} show={String} canChoose onChoose={() => {}} />);
		expect(container.textContent).toBe("");
	});
});
