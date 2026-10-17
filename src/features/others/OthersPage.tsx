// Others: whatever a team keeps together that is not a note, a project, an asset or an office file (PDFs, archives, drafts). The folder
// browser, shown on the others folder.

import FileBrowser from "@/features/files/FileBrowser";

export default function OthersPage() {
	return <FileBrowser mode="others" />;
}
