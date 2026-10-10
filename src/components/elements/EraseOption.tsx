// A checkbox for delete dialogs: also remove the item from history, and from other people's copies
export default function EraseOption({ checked, onChange, what }: { checked: boolean; onChange: (checked: boolean) => void; what: string }) {
	return (
		<label className="flex cursor-pointer items-start gap-3 text-sm">
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 accent-primary" />
			<span>
				Erase for good
				<span className="block text-xs text-muted-foreground">
					Also removes {what} from this device's history, version list and activity feed, and asks everyone else's copy of Nexsync to do the same. Copies that
					were exported or backed up, and anyone running a changed app, keep it.
				</span>
			</span>
		</label>
	);
}
