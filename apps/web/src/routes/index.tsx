import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { api } from "@pikasync/backend/convex/_generated/api";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const { data: tasks } = useSuspenseQuery(convexQuery(api.tasks.get, {}));

	return (
		<div className="p-8">
			<h1 className="text-4xl font-bold">Tasks</h1>
			{tasks.length === 0 ? (
				<p className="mt-4 text-lg text-muted-foreground">No tasks yet.</p>
			) : (
				<ul className="mt-6 space-y-3">
					{tasks.map(({ _id, isCompleted, text }) => (
						<li key={_id} className="flex items-center gap-3">
							<span
								aria-hidden="true"
								className={
									isCompleted
										? "size-2 rounded-full bg-green-600"
										: "size-2 rounded-full bg-zinc-400"
								}
							/>
							<span>{text}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
