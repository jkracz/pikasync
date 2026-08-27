import { api } from "@pikasync/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

export type Team = FunctionReturnType<typeof api.teams.list>[number];

interface ActiveTeamValue {
	teams: Team[];
	activeTeam: Team | null;
	setActiveTeam: (id: string) => void;
}

const Ctx = createContext<ActiveTeamValue | null>(null);
const STORAGE_KEY = "pika.activeTeam";

export function ActiveTeamProvider({ children }: { children: ReactNode }) {
	const teams = useQuery(api.teams.list) ?? [];
	const [activeId, setActiveId] = useState<string | null>(() =>
		typeof window === "undefined"
			? null
			: window.localStorage.getItem(STORAGE_KEY),
	);

	const activeTeam = useMemo(
		() => teams.find((t) => t.id === activeId) ?? teams[0] ?? null,
		[teams, activeId],
	);

	useEffect(() => {
		if (activeTeam && typeof window !== "undefined") {
			window.localStorage.setItem(STORAGE_KEY, activeTeam.id);
		}
	}, [activeTeam]);

	const value = useMemo<ActiveTeamValue>(
		() => ({ teams, activeTeam, setActiveTeam: setActiveId }),
		[teams, activeTeam],
	);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveTeam(): ActiveTeamValue {
	const ctx = useContext(Ctx);
	if (!ctx) {
		throw new Error("useActiveTeam must be used within ActiveTeamProvider");
	}
	return ctx;
}
