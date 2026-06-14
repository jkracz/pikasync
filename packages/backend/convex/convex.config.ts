import posthog from "@posthog/convex/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";

import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	env: {
		POSTHOG_PROJECT_TOKEN: v.string(),
		POSTHOG_HOST: v.optional(v.string()),
		POSTHOG_PERSONAL_API_KEY: v.optional(v.string()),
		POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS: v.optional(v.string()),
	},
});

app.use(posthog, {
	env: {
		POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN,
		POSTHOG_HOST: app.env.POSTHOG_HOST,
		POSTHOG_PERSONAL_API_KEY: app.env.POSTHOG_PERSONAL_API_KEY,
		POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS:
			app.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS,
	},
});
app.use(aggregate);

export default app;
