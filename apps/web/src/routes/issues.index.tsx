import { api } from "@pikasync/backend/convex/_generated/api";
import type { Id } from "@pikasync/backend/convex/_generated/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { useActiveTeam } from "#/components/app-context";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import {
	ISSUE_STATUSES,
	type IssueStatus,
	PRIORITIES,
	type Priority,
	priorityBadgeClass,
	priorityLabel,
	statusBadgeClass,
	statusLabel,
} from "#/lib/issue-meta";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/issues/")({ component: IssuesPage });

function IssuesPage() {
	const { teams, activeTeam } = useActiveTeam();
	if (teams.length === 0) return <CreateFirstTeam />;
	if (!activeTeam) return null;
	return <IssuesList teamId={activeTeam.id} />;
}

function CreateFirstTeam() {
	const createTeam = useMutation(api.teams.create);
	const [key, setKey] = useState("");
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		setBusy(true);
		try {
			await createTeam({ key, name });
			toast.success("Team created");
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to create team");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Card className="mx-auto max-w-md">
			<CardHeader>
				<CardTitle>Create your first team</CardTitle>
				<CardDescription>
					A team owns issues. Its key prefixes issue identifiers (e.g. ENG-123).
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-1.5">
					<Label htmlFor="key">Key</Label>
					<Input
						id="key"
						placeholder="ENG"
						value={key}
						onChange={(e) => setKey(e.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="name">Name</Label>
					<Input
						id="name"
						placeholder="Engineering"
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</div>
				<Button onClick={submit} disabled={busy || !key.trim()}>
					Create team
				</Button>
			</CardContent>
		</Card>
	);
}

function NewIssueDialog({ teamId }: { teamId: Id<"teams"> }) {
	const create = useMutation(api.issues.create);
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const [status, setStatus] = useState<IssueStatus>("backlog");
	const [priority, setPriority] = useState<Priority>("none");
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		if (!title.trim()) return;
		setBusy(true);
		try {
			await create({ teamId, title: title.trim(), status, priority });
			toast.success("Issue created");
			setTitle("");
			setStatus("backlog");
			setPriority("none");
			setOpen(false);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to create issue");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>New issue</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New issue</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="issue-title">Title</Label>
						<Input
							id="issue-title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Add OAuth login"
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label>Status</Label>
							<Select
								value={status}
								onValueChange={(v) => setStatus(v as IssueStatus)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ISSUE_STATUSES.map((s) => (
										<SelectItem key={s.value} value={s.value}>
											{s.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<Label>Priority</Label>
							<Select
								value={priority}
								onValueChange={(v) => setPriority(v as Priority)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PRIORITIES.map((p) => (
										<SelectItem key={p.value} value={p.value}>
											{p.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button onClick={submit} disabled={busy || !title.trim()}>
						Create
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function IssuesList({ teamId }: { teamId: Id<"teams"> }) {
	const [filter, setFilter] = useState<string>("all");
	const issues = useQuery(api.issues.list, {
		teamId,
		status: filter === "all" ? undefined : (filter as IssueStatus),
	});

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<h1 className="font-semibold text-xl">Issues</h1>
				<Select value={filter} onValueChange={setFilter}>
					<SelectTrigger className="h-8 w-44">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						{ISSUE_STATUSES.map((s) => (
							<SelectItem key={s.value} value={s.value}>
								{s.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="ml-auto">
					<NewIssueDialog teamId={teamId} />
				</div>
			</div>

			{issues === undefined ? (
				<div className="space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : issues.length === 0 ? (
				<p className="py-12 text-center text-muted-foreground text-sm">
					No issues yet. Create your first one.
				</p>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-24">ID</TableHead>
								<TableHead>Title</TableHead>
								<TableHead className="w-32">Status</TableHead>
								<TableHead className="w-24">Priority</TableHead>
								<TableHead className="w-40">Assignee</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{issues.map((issue) => (
								<TableRow key={issue.id}>
									<TableCell className="font-mono text-muted-foreground text-xs">
										{issue.identifier}
									</TableCell>
									<TableCell>
										<Link
											to="/issues/$issueId"
											params={{ issueId: issue.id }}
											className="font-medium hover:underline"
										>
											{issue.title}
										</Link>
									</TableCell>
									<TableCell>
										<Badge
											variant="secondary"
											className={cn(
												"font-normal",
												statusBadgeClass(issue.status),
											)}
										>
											{statusLabel(issue.status)}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge
											variant="secondary"
											className={cn(
												"font-normal",
												priorityBadgeClass(issue.priority),
											)}
										>
											{priorityLabel(issue.priority)}
										</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{issue.assignee ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
