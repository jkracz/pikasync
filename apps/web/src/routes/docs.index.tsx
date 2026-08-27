import { api } from "@pikasync/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
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

export const Route = createFileRoute("/docs/")({ component: DocsPage });

type DocType = "doc" | "plan";

function NewDocDialog() {
	const create = useMutation(api.documents.create);
	const [open, setOpen] = useState(false);
	const [docType, setDocType] = useState<DocType>("doc");
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		if (!title.trim()) return;
		setBusy(true);
		try {
			await create({ docType, title: title.trim() });
			toast.success(docType === "plan" ? "Plan created" : "Document created");
			setTitle("");
			setDocType("doc");
			setOpen(false);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to create");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>New document</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New document</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label>Type</Label>
						<Select
							value={docType}
							onValueChange={(v) => setDocType(v as DocType)}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="doc">Document</SelectItem>
								<SelectItem value="plan">Plan</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="doc-title">Title</Label>
						<Input
							id="doc-title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Auth architecture"
						/>
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

function DocsPage() {
	const docs = useQuery(api.documents.list, {});

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<h1 className="font-semibold text-xl">Documents &amp; Plans</h1>
				<div className="ml-auto">
					<NewDocDialog />
				</div>
			</div>

			{docs === undefined ? (
				<div className="space-y-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : docs.length === 0 ? (
				<p className="py-12 text-center text-muted-foreground text-sm">
					No documents yet.
				</p>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Title</TableHead>
								<TableHead className="w-24">Type</TableHead>
								<TableHead className="w-28">Status</TableHead>
								<TableHead className="w-44">Updated</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{docs.map((doc) => (
								<TableRow key={doc.id}>
									<TableCell>
										<Link
											to="/docs/$docId"
											params={{ docId: doc.id }}
											className="font-medium hover:underline"
										>
											{doc.title}
										</Link>
									</TableCell>
									<TableCell>
										<Badge
											variant={doc.docType === "plan" ? "default" : "secondary"}
										>
											{doc.docType}
										</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{doc.planStatus ?? "—"}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{new Date(doc.updatedAt).toLocaleDateString()}
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
