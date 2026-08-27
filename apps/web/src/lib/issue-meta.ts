export const ISSUE_STATUSES = [
	{ value: "backlog", label: "Backlog" },
	{ value: "todo", label: "Todo" },
	{ value: "in_progress", label: "In Progress" },
	{ value: "in_review", label: "In Review" },
	{ value: "done", label: "Done" },
	{ value: "canceled", label: "Canceled" },
] as const;

export const PRIORITIES = [
	{ value: "none", label: "None" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "urgent", label: "Urgent" },
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number]["value"];
export type Priority = (typeof PRIORITIES)[number]["value"];

export function statusLabel(s: string): string {
	return ISSUE_STATUSES.find((x) => x.value === s)?.label ?? s;
}

export function priorityLabel(p: string): string {
	return PRIORITIES.find((x) => x.value === p)?.label ?? p;
}

export function statusBadgeClass(s: string): string {
	switch (s) {
		case "in_progress":
			return "bg-blue-100 text-blue-800";
		case "in_review":
			return "bg-purple-100 text-purple-800";
		case "done":
			return "bg-green-100 text-green-800";
		case "canceled":
			return "bg-zinc-100 text-zinc-500 line-through";
		case "todo":
			return "bg-amber-100 text-amber-800";
		default:
			return "bg-zinc-100 text-zinc-700";
	}
}

export function priorityBadgeClass(p: string): string {
	switch (p) {
		case "urgent":
			return "bg-red-100 text-red-800";
		case "high":
			return "bg-orange-100 text-orange-800";
		case "medium":
			return "bg-yellow-100 text-yellow-800";
		case "low":
			return "bg-zinc-100 text-zinc-600";
		default:
			return "bg-transparent text-zinc-400";
	}
}
