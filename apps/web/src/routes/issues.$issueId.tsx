import { api } from "@pikasync/backend/convex/_generated/api";
import type { Id } from "@pikasync/backend/convex/_generated/dataModel";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
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
import { Textarea } from "#/components/ui/textarea";
import {
	ISSUE_STATUSES,
	type IssueStatus,
	PRIORITIES,
	type Priority,
} from "#/lib/issue-meta";

export const Route = createFileRoute("/issues/$issueId")({
	component: IssueDetailPage,
});

type IssueDoc = NonNullable<FunctionReturnType<typeof api.issues.get>>;

function IssueDetailPage() {
	const { issueId } = Route.useParams();
	const issue = useQuery(api.issues.get, {
		issueId: issueId as Id<"issues">,
	});

	if (issue === undefined) {
		return (
			<div className="space-y-3">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-48 w-full" />
			</div>
		);
	}
	if (issue === null) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				Issue not found.{" "}
				<Link to="/issues" className="underline">
					Back to issues
				</Link>
			</div>
		);
	}
	return <IssueEditor key={issue.id} issue={issue} />;
}

function parseLabels(input: string): string[] {
	return input
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function IssueEditor({ issue }: { issue: IssueDoc }) {
	const navigate = useNavigate();
	const update = useMutation(api.issues.update);
	const archive = useMutation(api.issues.archive);
	const remove = useMutation(api.issues.remove);
	const activity = useQuery(api.events.listForEntity, {
		entityUlid: issue.ulid,
	});

	const [title, setTitle] = useState(issue.title);
	const [status, setStatus] = useState<IssueStatus>(issue.status);
	const [priority, setPriority] = useState<Priority>(issue.priority);
	const [assignee, setAssignee] = useState(issue.assignee ?? "");
	const [labels, setLabels] = useState(issue.labels.join(", "));
	const [due, setDue] = useState(issue.due ?? "");
	const [body, setBody] = useState(issue.body);
	const [busy, setBusy] = useState(false);
	// Capture the version at edit-start so concurrent remote edits actually
	// trigger the server's optimistic-concurrency check instead of being clobbered.
	const [baseVersion, setBaseVersion] = useState(issue.version);

	const remoteChanged = issue.version !== baseVersion;
	const adoptRemote = () => {
		setTitle(issue.title);
		setStatus(issue.status);
		setPriority(issue.priority);
		setAssignee(issue.assignee ?? "");
		setLabels(issue.labels.join(", "));
		setDue(issue.due ?? "");
		setBody(issue.body);
		setBaseVersion(issue.version);
	};

	const save = async () => {
		setBusy(true);
		try {
			const result = await update({
				issueId: issue.id,
				expectedVersion: baseVersion,
				title: title.trim() || issue.title,
				status,
				priority,
				assignee: assignee.trim() ? assignee.trim() : null,
				labels: parseLabels(labels),
				due: due.trim() ? due.trim() : null,
				body,
			});
			setBaseVersion(result.version);
			toast.success("Saved");
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to save");
		} finally {
			setBusy(false);
		}
	};

	const doArchive = async () => {
		try {
			await archive({ issueId: issue.id });
			toast.success("Archived");
			navigate({ to: "/issues" });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed");
		}
	};

	const doDelete = async () => {
		try {
			await remove({ issueId: issue.id });
			toast.success("Deleted");
			navigate({ to: "/issues" });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed");
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<Link to="/issues" className="hover:underline">
					Issues
				</Link>
				<span>/</span>
				<span className="font-mono">{issue.identifier}</span>
			</div>

			{remoteChanged ? (
				<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
					This issue changed elsewhere (now v{issue.version}). Saving will
					conflict until you{" "}
					<button
						type="button"
						onClick={adoptRemote}
						className="font-medium underline"
					>
						discard your edits and reload
					</button>
					.
				</div>
			) : null}

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
				<div className="space-y-4">
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						className="!text-lg h-auto py-2 font-semibold"
					/>
					<div className="space-y-1.5">
						<Label htmlFor="body">Description (Markdown)</Label>
						<Textarea
							id="body"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							rows={14}
							className="font-mono text-sm"
						/>
					</div>
					{body.trim() ? (
						<div className="rounded-md border p-4">
							<p className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">
								Preview
							</p>
							<div className="prose prose-sm dark:prose-invert max-w-none">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{body}
								</ReactMarkdown>
							</div>
						</div>
					) : null}
				</div>

				<div className="space-y-4">
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
					<div className="space-y-1.5">
						<Label htmlFor="assignee">Assignee</Label>
						<Input
							id="assignee"
							value={assignee}
							onChange={(e) => setAssignee(e.target.value)}
							placeholder="email or id"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="labels">Labels (comma-separated)</Label>
						<Input
							id="labels"
							value={labels}
							onChange={(e) => setLabels(e.target.value)}
							placeholder="auth, backend"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="due">Due date</Label>
						<Input
							id="due"
							type="date"
							value={due}
							onChange={(e) => setDue(e.target.value)}
						/>
					</div>

					<div className="flex flex-col gap-2 pt-2">
						<Button onClick={save} disabled={busy}>
							Save
						</Button>
						<Button variant="outline" onClick={doArchive} disabled={busy}>
							Archive
						</Button>
						<Button variant="ghost" onClick={doDelete} disabled={busy}>
							Delete
						</Button>
					</div>

					<div className="space-y-1 border-t pt-3 text-muted-foreground text-xs">
						<p>Version {issue.version}</p>
						<p>Updated {new Date(issue.updatedAt).toLocaleString()}</p>
						<p>Created {new Date(issue.createdAt).toLocaleString()}</p>
					</div>

					<div className="border-t pt-3">
						<p className="mb-2 font-medium text-sm">Activity</p>
						<ul className="space-y-1 text-muted-foreground text-xs">
							{(activity ?? []).map((e) => (
								<li key={e.id}>
									<span className="font-medium text-foreground">{e.kind}</span>{" "}
									<span className="rounded bg-muted px-1">{e.actorType}</span> ·{" "}
									{new Date(e.creationTime).toLocaleString()}
								</li>
							))}
						</ul>
					</div>
				</div>
			</div>
		</div>
	);
}
