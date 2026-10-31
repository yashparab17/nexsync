import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ApprovalsDialog from "@/features/office/documents/components/ApprovalsDialog";
import { approvalChannel } from "@/features/office/documents/lib/documentApprovals";
import { ChatContext, NONE } from "@/store/chat/ChatContext";

afterEach(cleanup);

const people = [{ name: "Ana", deviceId: "A1" }, { name: "Bo", deviceId: "B1" }];
const mount = (post = vi.fn(async () => ({ id: "x" }) as never), entries: never[] = []) =>
	render(
		<ChatContext.Provider value={{ ...NONE, people, me: "A1", post, entries } as never}>
			<ApprovalsDialog path="documents/r.docx" text={() => "The report"} canAct onClose={() => {}} />
		</ChatContext.Provider>,
	);

describe("approvals dialog", () => {
	it("signs the document as it is, on its own channel", async () => {
		const post = vi.fn(async () => ({ id: "x" }) as never);
		mount(post);
		await waitFor(() => expect((screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(screen.getByRole("button", { name: "Sign" }));
		await waitFor(() => expect(post).toHaveBeenCalled());
		const arg = (post.mock.calls[0] as unknown as [{ channel: string; body: string; kind: string }])[0];
		expect(arg.channel).toBe(approvalChannel("documents/r.docx"));
		expect(arg.kind).toBe("comment");
		expect(JSON.parse(arg.body).approval.kind).toBe("sign");
	});

	it("asks the people chosen to review, and only others than you can be chosen", async () => {
		const post = vi.fn(async () => ({ id: "x" }) as never);
		mount(post);
		expect(screen.queryByLabelText("Ana")).toBeNull();
		fireEvent.click(screen.getByLabelText("Bo"));
		await waitFor(() => expect((screen.getByRole("button", { name: "Request Review" }) as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(screen.getByRole("button", { name: "Request Review" }));
		await waitFor(() => expect(post).toHaveBeenCalled());
		const arg = (post.mock.calls[0] as unknown as [{ body: string }])[0];
		expect(JSON.parse(arg.body).approval).toMatchObject({ kind: "request", reviewers: ["Bo"] });
	});
});
