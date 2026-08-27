import { UserButton } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useActiveTeam } from "#/components/app-context";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";

export function AppShell({ children }: { children: ReactNode }) {
	const { teams, activeTeam, setActiveTeam } = useActiveTeam();

	return (
		<div className="min-h-screen bg-background">
			<header className="border-b">
				<div className="flex h-14 items-center gap-4 px-4">
					<Link to="/issues" className="font-semibold tracking-tight">
						Pika<span className="text-amber-500">Sync</span>
					</Link>

					{teams.length > 0 && activeTeam ? (
						<Select value={activeTeam.id} onValueChange={setActiveTeam}>
							<SelectTrigger className="h-8 w-48">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{teams.map((t) => (
									<SelectItem key={t.id} value={t.id}>
										{t.key} · {t.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}

					<nav className="flex items-center gap-1 text-sm">
						<Link
							to="/issues"
							className="rounded px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
						>
							Issues
						</Link>
						<Link
							to="/docs"
							className="rounded px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
						>
							Docs
						</Link>
						<Link
							to="/settings"
							className="rounded px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
						>
							Settings
						</Link>
					</nav>

					<div className="ml-auto">
						<UserButton />
					</div>
				</div>
			</header>
			<main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
		</div>
	);
}
