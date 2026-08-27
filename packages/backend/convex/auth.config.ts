/**
 * Clerk auth provider for Convex.
 *
 * `domain` is the Clerk Frontend API / JWT issuer URL, set on the **deployment**
 * (`npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<app>.clerk.accounts.dev`).
 * `applicationID` MUST equal the name of the Clerk JWT template ("convex").
 *
 * Add these claims to the "convex" JWT template to expose org context:
 *   { "org_id": "{{org.id}}", "org_slug": "{{org.slug}}", "org_role": "{{org.role}}" }
 */
export default {
	providers: [
		{
			domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
			applicationID: "convex",
		},
	],
};
