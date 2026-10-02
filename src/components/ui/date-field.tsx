import { parseDate } from "@internationalized/date";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
	Button,
	Calendar,
	CalendarCell,
	CalendarGrid,
	CalendarGridBody,
	CalendarGridHeader,
	CalendarHeaderCell,
	DateInput,
	DatePicker,
	DateSegment,
	Dialog,
	Group,
	Heading,
	Popover,
} from "react-aria-components";

import { cn } from "@/lib/utils";

// "YYYY-MM-DD", or nothing for a value that is empty or not a date
function toDate(value: string) {
	try {
		return value ? parseDate(value) : null;
	} catch {
		return null;
	}
}

const navButton = "flex size-8 items-center justify-center text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

// Date picker in the app's own style: typed segments plus a calendar popup, value as "YYYY-MM-DD" ("" when cleared)
export function DateField({
	id,
	value,
	onChange,
	className,
	"aria-label": ariaLabel = "Date",
}: {
	id?: string;
	value: string;
	onChange: (value: string) => void;
	className?: string;
	"aria-label"?: string;
}) {
	return (
		<DatePicker aria-label={ariaLabel} value={toDate(value)} onChange={(d) => onChange(d ? d.toString() : "")} className={cn("group", className)}>
			<Group
				id={id}
				className="flex h-10 w-full items-center border border-input bg-background pl-3 text-sm focus-within:ring-2 focus-within:ring-ring"
			>
				<DateInput className="flex flex-1 items-center">
					{(segment) => (
						<DateSegment
							segment={segment}
							className="px-0.5 tabular-nums caret-transparent outline-none data-[placeholder]:text-muted-foreground data-[focused]:bg-primary data-[focused]:text-primary-foreground"
						/>
					)}
				</DateInput>
				{value && (
					<Button
						slot={null}
						aria-label="Clear date"
						onPress={() => onChange("")}
						className="flex size-8 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>
						<X className="size-4" />
					</Button>
				)}
				<Button aria-label="Open calendar" className="flex h-full w-10 items-center justify-center border-l border-input text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
					<CalendarIcon className="size-4" />
				</Button>
			</Group>
			<Popover placement="bottom end" className="z-[70] border border-border bg-popover p-3 text-popover-foreground shadow-md">
				<Dialog className="outline-none">
					<Calendar>
						<header className="mb-2 flex items-center justify-between">
							<Button slot="previous" className={navButton}>
								<ChevronLeft className="size-4" />
							</Button>
							<Heading className="text-sm font-semibold" />
							<Button slot="next" className={navButton}>
								<ChevronRight className="size-4" />
							</Button>
						</header>
						<CalendarGrid className="border-separate border-spacing-0.5">
							<CalendarGridHeader>
								{(day) => <CalendarHeaderCell className="size-9 text-xs font-medium text-muted-foreground">{day}</CalendarHeaderCell>}
							</CalendarGridHeader>
							<CalendarGridBody>
								{(date) => (
									<CalendarCell
										date={date}
										className={({ isSelected, isOutsideMonth, isDisabled, isFocusVisible }) =>
											cn(
												"flex size-9 cursor-pointer items-center justify-center text-sm tabular-nums outline-none hover:bg-muted",
												isOutsideMonth && "invisible",
												isDisabled && "pointer-events-none opacity-40",
												isSelected && "bg-primary text-primary-foreground hover:bg-primary",
												isFocusVisible && "ring-2 ring-ring",
											)
										}
									/>
								)}
							</CalendarGridBody>
						</CalendarGrid>
					</Calendar>
				</Dialog>
			</Popover>
		</DatePicker>
	);
}
