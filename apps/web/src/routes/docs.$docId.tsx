import { api } from "@pikasync/backend/convex/_generated/api";
import type { Id } from "@pikasync/backend/convex/_generated/dataModel";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
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

export const Route = createFileRoute("/docs/$docId")({
	component: DocDetailPage,
});

type DocDoc = NonNullable<FunctionReturnType<typeof api.documents.get>>;
type PlanStatus = "draft" | "approved" | "active" | "superseded" | "done";

const PLAN_STATUSES: { value: PlanStatus; label: string }[] = [
	{ value: "draft", label: "Draft" },
	{ value: "approved", label: "Approved" },
	{ value: "active", label: "Active" },
	{ value: "superseded", label: "Superseded" },
	{ value: "done", label: "Done" },
];

function DocDetailPage() {
	const { docId } = Route.useParams();
	const doc = useQuery(api.documents.get, {
		documentId: docId as Id<"documents">,
	});

	if (doc === undefined) {
		return (
			<div className="space-y-3">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-48 w-full" />
			</div>
		);
	}
	if (doc === null) {
		return (
			<div className="py-12 text-center text-muted-foreground text-sm">
				Document not found.{" "}
				<Link to="/docs" className="underline">
					Back to documents
				</Link>
			</div>
		);
	}
	return <DocEditor key={doc.id} doc={doc} />;
}

function DocEditor({ doc }: { doc: DocDoc }) {
	const navigate = useNavigate();
	const update = useMutation(api.documents.update);
	const archive = useMutation(api.documents.archive);
	const remove = useMutation(api.documents.remove);

	const [title, setTitle] = useState(doc.title);
	const [body, setBody] = useState(doc.body);
	const [planStatus, setPlanStatus] = useState<PlanStatus>(
		(doc.planStatus as PlanStatus | undefined) ?? "draft",
	);
	const [busy, setBusy] = useState(false);
	// Capture the version at edit-start so concurrent remote edits trigger the
	// server's optimistic-concurrency check instead of being silently clobbered.
	const [baseVersion, setBaseVersion] = useState(doc.version);

	const remoteChanged = doc.version !== baseVersion;
	const adoptRemote = () => {
		setTitle(doc.title);
		setBody(doc.body);
		setPlanStatus((doc.planStatus as PlanStatus | undefined) ?? "draft");
		setBaseVersion(doc.version);
	};

	const save = async () => {
		setBusy(true);
		try {
			const result = await update({
				documentId: doc.id,
				expectedVersion: baseVersion,
				title: title.trim() || doc.title,
				body,
				planStatus: doc.docType === "plan" ? planStatus : undefined,
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
			await archive({ documentId: doc.id });
			toast.success("Archived");
			navigate({ to: "/docs" });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed");
		}
	};

	const doDelete = async () => {
		try {
			await remove({ documentId: doc.id });
			toast.success("Deleted");
			navigate({ to: "/docs" });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed");
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<Link to="/docs" className="hover:underline">
					Documents
				</Link>
				<span>/</span>
				<Badge variant={doc.docType === "plan" ? "default" : "secondary"}>
					{doc.docType}
				</Badge>
			</div>

			{remoteChanged ? (
				<div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">
					This document changed elsewhere (now v{doc.version}). Saving will
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

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
				<div className="space-y-4">
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						className="!text-lg h-auto py-2 font-semibold"
					/>
					<div className="space-y-1.5">
						<Label htmlFor="doc-body">Content (Markdown)</Label>
						<Textarea
							id="doc-body"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							rows={18}
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
					{doc.docType === "plan" ? (
						<div className="space-y-1.5">
							<Label>Plan status</Label>
							<Select
								value={planStatus}
								onValueChange={(v) => setPlanStatus(v as PlanStatus)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PLAN_STATUSES.map((s) => (
										<SelectItem key={s.value} value={s.value}>
											{s.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : null}

					<div className="flex flex-col gap-2">
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
						<p>Version {doc.version}</p>
						<p>Updated {new Date(doc.updatedAt).toLocaleString()}</p>
						<p>Created {new Date(doc.createdAt).toLocaleString()}</p>
					</div>
				</div>
			</div>
		</div>
	);
}
