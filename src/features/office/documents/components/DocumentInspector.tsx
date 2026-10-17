import { AlertTriangle } from "@/components/animate-icons";
import type { OfficeInspect } from "@/features/office/types";

// What a document holds that a person should know before it goes to someone else, and what the editor did not take from the file
export default function DocumentInspector({ inspect, inline = false }: { inspect: OfficeInspect; inline?: boolean }) {
	const rows: [string, string][] = [
		["Words", inspect.words.toLocaleString()],
		["Pictures", String(inspect.images)],
		["Comments", String(inspect.comments)],
		["Tracked changes", String(inspect.revisions)],
	];
	return (
		<aside aria-label="What this file holds" className={inline ? "space-y-4 text-sm" : "w-72 shrink-0 space-y-4 overflow-y-auto border-l p-4 text-sm"}>
			<h2 className="text-sm font-semibold">What This File Holds</h2>
			<dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
				{rows.map(([k, v]) => (
					<div key={k} className="contents">
						<dt className="text-muted-foreground">{k}</dt>
						<dd className="font-mono">{v}</dd>
					</div>
				))}
			</dl>
			{inspect.people.length > 0 && (
				<section>
					<h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">Names in the file</h3>
					<p>{inspect.people.join(", ")}</p>
					<p className="mt-1 text-[13px] text-muted-foreground">These stay in the file when it is shared. Exporting without a name leaves them out of the new file.</p>
				</section>
			)}
			{inspect.macros && (
				<p className="flex gap-2 bg-warning/10 p-2 text-[13px]">
					<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
					This file carries a macro project. Nexsync never runs it and does not copy it into the editor.
				</p>
			)}
			{inspect.external.length > 0 && (
				<section>
					<h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">Points outside the file</h3>
					<ul className="space-y-0.5 font-mono text-[13px]">
						{inspect.external.slice(0, 12).map((e) => (
							<li key={e} className="break-all">
								{e}
							</li>
						))}
						{inspect.external.length > 12 && <li className="text-muted-foreground">and {inspect.external.length - 12} more</li>}
					</ul>
					<p className="mt-1 text-[13px] text-muted-foreground">Nothing is fetched from these.</p>
				</section>
			)}
			{inspect.leftOut.length > 0 && (
				<section>
					<h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">Not carried into the editor</h3>
					<ul className="list-disc space-y-1 pl-4 text-[13px]">
						{inspect.leftOut.map((l) => (
							<li key={l}>{l}</li>
						))}
					</ul>
					<p className="mt-1 text-[13px] text-muted-foreground">The original file keeps them until Update the File replaces it.</p>
				</section>
			)}
		</aside>
	);
}
