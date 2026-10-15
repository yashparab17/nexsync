// The order to start a project's tasks in: each one after the tasks it waits on. Start All asks for the tasks that keep running
// (servers and watchers); what they wait on (an install, a database) comes in with them.

import type { TaskSpec } from "@/types/projects";

export function startOrder(tasks: TaskSpec[], wanted: string[]): TaskSpec[] {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const order: TaskSpec[] = [];
	const visiting = new Set<string>();
	const visit = (id: string) => {
		const t = byId.get(id);
		if (!t || order.includes(t)) return;
		// A loop of tasks waiting on each other cannot be ordered; each is started once, in the order met
		if (visiting.has(id)) return;
		visiting.add(id);
		t.dependsOn.forEach(visit);
		order.push(t);
	};
	wanted.forEach(visit);
	return order;
}

export const serverIds = (tasks: TaskSpec[]) => tasks.filter((t) => t.watch).map((t) => t.id);
