// Workspace assets management view
export default function WorkspaceAssets() {
	return (
		<div className="space-y-4">
			<div>
				<h1 className="text-2xl font-semibold">Assets</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Manage and view workspace assets.
				</p>
			</div>
			<div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
				No assets uploaded yet.
			</div>
		</div>
	);
}
