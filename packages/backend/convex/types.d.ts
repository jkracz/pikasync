// The Convex runtime exposes deployment environment variables via `process.env`
// (used in auth.config.ts). We declare only that surface rather than pulling in
// full @types/node, since the default Convex runtime is not Node.
declare const process: { readonly env: Record<string, string | undefined> };
