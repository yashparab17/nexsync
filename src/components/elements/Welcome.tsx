// What Notes and the Editor show when nothing is open: the things to do next with their keys, what was opened lately, and a
// tip. Built from the same panels as every other workspace page.

import type { ReactNode } from "react";
import { Keyboard } from "@/components/animate-icons";

import Art, { type ArtName } from "@/components/elements/Art";
import { Panel } from "@/components/layout/Page";

export interface WelcomeAction {
	label: string;
	icon: ReactNode;
	run: () => void;
	keys?: string;
}

export interface WelcomeItem {
	key: string;
	label: string;
	sub?: string;
	icon: ReactNode;
	run: () => void;
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="border bg-card px-2 py-0.5 font-mono text-[13px] text-muted-foreground">{children}</kbd>;

export default function Welcome({ logo, title, intro, actions, recentTitle, recent, recentEmpty, tip, art }: { art?: ArtName; logo?: string; title: string; intro: ReactNode; actions: WelcomeAction[]; recentTitle: string; recent: WelcomeItem[]; recentEmpty: string; tip?: string }) {
	return (
		<div className="h-full overflow-auto p-3">
			<div className="mx-auto flex max-w-4xl flex-col gap-3 py-6">
				<header className={logo ? "flex flex-col items-center gap-3 px-1 pb-4 text-center" : "px-1 pb-2"}>
					{logo && (
						<pre aria-label="Nexsync" className="font-mono text-[0.7rem] leading-none whitespace-pre text-primary select-none sm:text-sm [font-variant-ligatures:none]">
							{logo}
						</pre>
					)}
					<h2 className="text-xl font-semibold">{title}</h2>
					<p className="mt-1 text-sm text-muted-foreground">{intro}</p>
				</header>
				<div className="grid gap-3 md:grid-cols-2">
					<Panel title="Get Started" flush>
						<ul className="divide-y">
							{actions.map((a) => (
								<li key={a.label}>
									<button type="button" onClick={a.run} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
										<span className="text-primary">{a.icon}</span>
										<span className="flex-1">{a.label}</span>
										{a.keys && <Kbd>{a.keys}</Kbd>}
									</button>
								</li>
							))}
						</ul>
					</Panel>
					<Panel title={recentTitle} flush={recent.length > 0}>
						{recent.length === 0 ? (
							<div className="bg-dots flex flex-col items-center gap-3 py-2 text-center">
								{art && <Art name={art} className="h-32 w-52" />}
								<p className="text-sm text-muted-foreground">{recentEmpty}</p>
							</div>
						) : (
							<ul className="divide-y">
								{recent.map((r) => (
									<li key={r.key}>
										<button type="button" onClick={r.run} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted">
											{r.icon}
											<span className="min-w-0 flex-1 truncate">{r.label}</span>
											{r.sub && <span className="max-w-[40%] shrink-0 truncate font-mono text-[13px] text-muted-foreground">{r.sub}</span>}
										</button>
									</li>
								))}
							</ul>
						)}
					</Panel>
				</div>
				{tip && (
					<p className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
						<Keyboard className="mt-0.5 size-4 shrink-0 text-primary" />
						{tip}
					</p>
				)}
			</div>
		</div>
	);
}
