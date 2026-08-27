import { OrganizationSwitcher, SignIn } from "@clerk/tanstack-react-start";
import { api } from "@pikasync/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { env } from "#/env";

const CLERK_ENABLED = Boolean(env.VITE_CLERK_PUBLISHABLE_KEY);

function Centered({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			{children}
		</div>
	);
}

function Loading({ label = "Loading…" }: { label?: string }) {
	return (
		<Centered>
			<p className="text-muted-foreground text-sm">{label}</p>
		</Centered>
	);
}

function SetupNotice() {
	return (
		<Centered>
			<div className="max-w-lg space-y-3 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
				<h1 className="font-semibold text-lg">
					PikaSync needs Clerk to sign in
				</h1>
				<p className="text-muted-foreground text-sm">
					Set{" "}
					<code className="rounded bg-muted px-1">
						VITE_CLERK_PUBLISHABLE_KEY
					</code>{" "}
					in <code className="rounded bg-muted px-1">apps/web/.env.local</code>{" "}
					and set the deployment's issuer:
				</p>
				<pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
					npx convex env set CLERK_JWT_ISSUER_DOMAIN
					https://YOUR.clerk.accounts.dev
				</pre>
				<p className="text-muted-foreground text-sm">
					Create a Clerk JWT template named <strong>convex</strong> with{" "}
					<code className="rounded bg-muted px-1">org_id</code>,{" "}
					<code className="rounded bg-muted px-1">org_slug</code>,{" "}
					<code className="rounded bg-muted px-1">org_role</code> claims, then
					reload.
				</p>
			</div>
		</Centered>
	);
}

export function AuthGate({ children }: { children: ReactNode }) {
	// CLERK_ENABLED is a build-time constant, so this branch is stable.
	if (!CLERK_ENABLED) return <SetupNotice />;
	return <AuthGateInner>{children}</AuthGateInner>;
}

function AuthGateInner({ children }: { children: ReactNode }) {
	const { isLoading, isAuthenticated } = useConvexAuth();
	if (isLoading) return <Loading />;
	if (!isAuthenticated) {
		return (
			<Centered>
				<SignIn routing="hash" />
			</Centered>
		);
	}
	return <Provisioned>{children}</Provisioned>;
}

function Provisioned({ children }: { children: ReactNode }) {
	const current = useQuery(api.users.current);
	const bootstrap = useMutation(api.users.bootstrap);
	const [bootstrapError, setBootstrapError] = useState<unknown>(null);
	const inFlight = useRef(false);

	const runBootstrap = useCallback(() => {
		if (inFlight.current) return;
		inFlight.current = true;
		setBootstrapError(null);
		bootstrap({})
			.catch((e) => setBootstrapError(e))
			.finally(() => {
				inFlight.current = false;
			});
	}, [bootstrap]);

	useEffect(() => {
		if (current === null) runBootstrap();
	}, [current, runBootstrap]);

	if (bootstrapError) {
		return (
			<Centered>
				<div className="max-w-md space-y-3 text-center">
					<h1 className="font-semibold text-lg">Setup failed</h1>
					<p className="text-muted-foreground text-sm">
						{bootstrapError instanceof Error
							? bootstrapError.message
							: "Could not set up your account."}
					</p>
					<Button onClick={runBootstrap}>Retry</Button>
				</div>
			</Centered>
		);
	}

	if (current === undefined) return <Loading />;
	if (current === null) return <Loading label="Setting up your account…" />;
	if (!current.workspace) {
		return (
			<Centered>
				<div className="space-y-4 text-center">
					<h1 className="font-semibold text-lg">Choose an organization</h1>
					<p className="text-muted-foreground text-sm">
						PikaSync workspaces map to Clerk organizations. Select or create
						one.
					</p>
					<div className="flex justify-center">
						<OrganizationSwitcher
							hidePersonal
							afterCreateOrganizationUrl="/"
							afterSelectOrganizationUrl="/"
						/>
					</div>
				</div>
			</Centered>
		);
	}
	return <>{children}</>;
}
