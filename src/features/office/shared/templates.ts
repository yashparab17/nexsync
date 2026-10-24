// The starting points of the New dialogs: a document is a page of HTML, a workbook is what is typed in each cell

export const DOC_TEMPLATES = [
	{ id: "blank", label: "Blank document", html: "<p></p>" },
	{ id: "report", label: "Report", html: "<h1>Title</h1><p>Author · Date</p><h2>Summary</h2><p></p><h2>Background</h2><p></p><h2>Findings</h2><p></p><h2>Next steps</h2><p></p>" },
	{ id: "meeting", label: "Meeting notes", html: "<h1>Meeting notes</h1><p>Date · Attendees</p><h2>Agenda</h2><ul><li></li></ul><h2>Decisions</h2><ul><li></li></ul><h2>Action items</h2><ul><li></li></ul>" },
	{ id: "letter", label: "Letter", html: "<p>Your name</p><p>Your address</p><p>Date</p><p></p><p>Dear name,</p><p></p><p>Sincerely,</p><p>Your name</p>" },
] as const;

export const SHEET_TEMPLATES = [
	{ id: "blank", label: "Blank workbook", cells: {} as Record<string, string> },
	{ id: "budget", label: "Budget", cells: { A1: "Item", B1: "Planned", C1: "Actual", D1: "Difference", A2: "Rent", A3: "Food", A4: "Travel", D2: "=B2-C2", D3: "=B3-C3", D4: "=B4-C4", A5: "Total", B5: "=SUM(B2:B4)", C5: "=SUM(C2:C4)", D5: "=SUM(D2:D4)" } as Record<string, string> },
	{ id: "tasks", label: "Task list", cells: { A1: "Task", B1: "Owner", C1: "Due", D1: "Status" } as Record<string, string> },
] as const;
