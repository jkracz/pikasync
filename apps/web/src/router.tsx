import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexProvider } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { env } from "#/env";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const convexQueryClient = new ConvexQueryClient(env.VITE_CONVEX_URL);
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				queryKeyHashFn: convexQueryClient.hashFn(),
				queryFn: convexQueryClient.queryFn(),
			},
		},
	});

	convexQueryClient.connect(queryClient);

	const clerkKey = env.VITE_CLERK_PUBLISHABLE_KEY;

	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		context: { queryClient },
		Wrap: ({ children }) =>
			clerkKey ? (
				<ClerkProvider publishableKey={clerkKey}>
					<ConvexProviderWithClerk
						client={convexQueryClient.convexClient}
						useAuth={useAuth}
					>
						{children}
					</ConvexProviderWithClerk>
				</ClerkProvider>
			) : (
				<ConvexProvider client={convexQueryClient.convexClient}>
					{children}
				</ConvexProvider>
			),
	});

	setupRouterSsrQueryIntegration({ router, queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
