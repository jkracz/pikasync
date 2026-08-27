import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ActiveTeamProvider } from "#/components/app-context";
import { AppShell } from "#/components/app-shell";
import { AuthGate } from "#/components/auth-gate";
import { Toaster } from "#/components/ui/sonner";
import PostHogProvider from "../integrations/posthog/provider";

import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "PikaSync" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<PostHogProvider>
					<AuthGate>
						<ActiveTeamProvider>
							<AppShell>{children}</AppShell>
						</ActiveTeamProvider>
					</AuthGate>
					<Toaster />
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				</PostHogProvider>
				<Scripts />
			</body>
		</html>
	);
}
