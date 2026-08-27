import { api } from "@pikasync/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { env } from "#/env";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
	const tokens = useQuery(api.deviceTokens.list, {});
	const mint = useAction(api.deviceTokens.mint);
	const revoke = useMutation(api.deviceTokens.revoke);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [minted, setMinted] = useState<string | null>(null);

	const create = async () => {
		if (!name.trim()) return;
		setBusy(true);
		try {
			const r = await mint({ name: name.trim() });
			setMinted(r.token);
			setName("");
			toast.success("Device token created");
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Failed to create token");
		} finally {
			setBusy(false);
		}
	};

	const initCommand = minted
		? `pika init --url ${env.VITE_CONVEX_URL} --token ${minted}`
		: "";

	const copy = (text: string) => {
		navigator.clipboard?.writeText(text);
		toast.success("Copied");
	};

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<div>
				<h1 className="font-semibold text-xl">Device tokens</h1>
				<p className="text-muted-foreground text-sm">
					Tokens let the <code className="rounded bg-muted px-1">pika</code> daemon
					sync this workspace into a repo. The secret is shown once.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>New token</CardTitle>
					<CardDescription>
						Scoped to all teams you belong to. Name it after the machine/repo.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-end gap-2">
						<div className="flex-1 space-y-1.5">
							<Label htmlFor="token-name">Name</Label>
							<Input
								id="token-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="laptop / pikasync repo"
							/>
						</div>
						<Button onClick={create} disabled={busy || !name.trim()}>
							Create
						</Button>
					</div>

					{minted ? (
						<div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
							<p className="font-medium text-amber-900 text-sm">
								Copy this now — it won't be shown again:
							</p>
							<div className="flex items-center gap-2">
								<code className="flex-1 overflow-x-auto rounded bg-white p-2 text-xs">
									{initCommand}
								</code>
								<Button size="sm" variant="outline" onClick={() => copy(initCommand)}>
									Copy
								</Button>
							</div>
						</div>
					) : null}
				</CardContent>
			</Card>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead className="w-32">Prefix</TableHead>
							<TableHead className="w-40">Created</TableHead>
							<TableHead className="w-28">Status</TableHead>
							<TableHead className="w-20" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{(tokens ?? []).map((t) => (
							<TableRow key={t.id}>
								<TableCell>{t.name}</TableCell>
								<TableCell className="font-mono text-muted-foreground text-xs">
									{t.prefix}…
								</TableCell>
								<TableCell className="text-muted-foreground text-sm">
									{new Date(t.createdAt).toLocaleDateString()}
								</TableCell>
								<TableCell>
									<Badge variant={t.revoked ? "secondary" : "default"}>
										{t.revoked ? "revoked" : "active"}
									</Badge>
								</TableCell>
								<TableCell>
									{t.revoked ? null : (
										<Button
											size="sm"
											variant="ghost"
											onClick={async () => {
												await revoke({ tokenId: t.id });
												toast.success("Revoked");
											}}
										>
											Revoke
										</Button>
									)}
								</TableCell>
							</TableRow>
						))}
						{tokens && tokens.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={5}
									className="py-8 text-center text-muted-foreground text-sm"
								>
									No device tokens yet.
								</TableCell>
							</TableRow>
						) : null}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
