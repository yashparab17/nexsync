import { describe, expect, it } from "vitest";

import { serverIds, startOrder } from "@/lib/taskOrder";
import type { TaskSpec } from "@/features/projects/types";

const t = (id: string, dependsOn: string[] = [], watch = false): TaskSpec => ({ id, label: id, command: id, cwd: "", env: [], ports: [], dependsOn, watch, interactive: false, readyWhen: "" });

describe("taskOrder", () => {
	it("starts what a task waits on first, each once", () => {
		const tasks = [t("web", ["api", "install"], true), t("api", ["db", "install"], true), t("db", [], true), t("install"), t("lint")];
		expect(startOrder(tasks, serverIds(tasks)).map((x) => x.id)).toEqual(["db", "install", "api", "web"]);
	});
	it("copes with tasks that wait on each other and on tasks that are not there", () => {
		const tasks = [t("a", ["b"]), t("b", ["a", "ghost"])];
		expect(startOrder(tasks, ["a"]).map((x) => x.id).sort()).toEqual(["a", "b"]);
	});
});
