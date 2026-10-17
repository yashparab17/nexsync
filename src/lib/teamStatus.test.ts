import { describe, expect, it } from "vitest";

import type { LogEntry } from "@/lib/chat/entries";
import { all, checklist, diffTools, tailOf, toolsDiffer, mixedNote, newest, runShareOf, type EnvShare, type Member } from "./teamStatus";

const entry = (author: string, name: string, ts: number, body: object, kind: "devenv" | "devrun" = "devenv", channel = "devenv:projects/app"): LogEntry => ({ id: `${author}${ts}`, kind, channel, parent: "", author, name, ts, body: JSON.stringify(body), sig: "" });
const env = (node: string | null, installed = true): EnvShare => ({ tools: [{ name: "node", range: ">=18", found: node, state: node ? "ok" : "missing" }], os: "Linux", installed });
const member = (name: string, data: EnvShare): Member<EnvShare> => ({ key: name, name, ts: 1, data });

describe("teamStatus", () => {
	it("keeps the newest entry of each author in the channel", () => {
		const list = [entry("a", "Ana", 1, env("18.0.0")), entry("a", "Ana", 5, env("20.1.0")), entry("b", "Ben", 2, env("22.0.0")), entry("b", "Ben", 3, { x: 1 }, "devenv", "devenv:other")];
		const got = newest<EnvShare>(list, "devenv", "devenv:projects/app");
		expect(got.map((m) => [m.name, m.data.tools[0]?.found])).toEqual([["Ana", "20.1.0"], ["Ben", "22.0.0"]]);
	});

	it("shows where versions differ first, and says it from my side", () => {
		const members = [member("Ana", env("22.1.0")), member("Ben", env("20.1.0")), member("Cy", env("20.1.0")), member("Di", env("20.1.0"))];
		const [row] = diffTools(members);
		expect(row.mixed).toBe(true);
		expect(row.groups[0]).toEqual({ version: "20.1.0", people: ["Ben", "Cy", "Di"] });
		expect(mixedNote(row, "Ana")).toBe("22.1.0 here, 20.1.0 for 3 others");
		expect(diffTools([member("Ana", env("20.1.0")), member("Ben", env(null))])[0].groups.map((g) => g.version)).toEqual(["20.1.0", "missing"]);
		expect(mixedNote(diffTools([member("Ana", env("20.1.0"))])[0], "Ana")).toBeNull();
	});

	it("leaves out the steps the recipe has nothing for", () => {
		const recipe = { server: ["dev"], tests: true, install: false };
		const run = { running: [], ever: ["dev"], test: { ok: true, at: 1 }, at: 2 };
		expect(checklist(env("20.1.0"), run, recipe).map((s) => [s.id, s.done])).toEqual([["tools", true], ["server", true], ["tests", true]]);
		expect(checklist(env(null, false), undefined, { server: [], tests: false, install: true }).map((s) => [s.id, s.done])).toEqual([["tools", false], ["install", false]]);
	});

	it("keeps the end of a long log whole lines at a time, without colours", () => {
		const lines = ["\x1b[31mone\x1b[0m", "two", "three"];
		expect(tailOf(lines, 100)).toEqual({ text: "one\ntwo\nthree", cut: false });
		expect(tailOf(lines, 8)).toEqual({ text: "three", cut: true });
		expect(tailOf([], 10)).toEqual({ text: "", cut: false });
	});

	it("lists every shared failure newest first and says which tools differ from mine", () => {
		const list = [entry("a", "Ana", 1, { task: "test" }, "devenv", "x"), { ...entry("a", "Ana", 5, { task: "test" }), kind: "devrepro" as const, channel: "devrepro:p" }, { ...entry("b", "Ben", 9, { task: "build" }), kind: "devrepro" as const, channel: "devrepro:p" }];
		expect(all<{ task: string }>(list, "devrepro", "devrepro:p").map((m) => [m.name, m.data.task])).toEqual([["Ben", "build"], ["Ana", "test"]]);
		const t = (name: string, found: string | null) => ({ name, range: "", found, state: "ok" });
		expect(toolsDiffer([t("node", "20.1.0"), t("go", "1.22.0"), t("uv", null)], [t("node", "22.0.0"), t("go", "1.22.0")])).toEqual([{ tool: "node", theirs: "20.1.0", mine: "22.0.0" }, { tool: "uv", theirs: "missing", mine: "missing" }].filter((d) => d.theirs !== d.mine));
	});

	it("reads the last test run and what ran from the history", () => {
		const h = [
			{ task: "test", code: 1, stopped: false, started: 10 },
			{ task: "test", code: 0, stopped: false, started: 20 },
			{ task: "test", code: 1, stopped: true, started: 30 },
			{ task: "dev", code: null, stopped: true, started: 5 },
		];
		const r = runShareOf(["dev", "dev"], h, 99);
		expect(r).toEqual({ running: ["dev"], ever: ["dev", "test"], test: { ok: true, at: 20 }, at: 99 });
	});
});
