import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowUpRight, Loader2, MessageCircleQuestion } from "lucide-react";
import { useSession } from "@/state/session";
import { useAtlasRuns } from "./engine";
import { activeAtlasRuns } from "./activity";

export function useAtlasActivity() {
  const vault = useSession((s) => s.vault);
  const runs = useAtlasRuns((s) => s.runs);
  return useMemo(() => activeAtlasRuns(vault, runs), [vault, runs]);
}

/** Visible on every page, including when the chat window has been closed. */
export function AtlasActivity() {
  const active = useAtlasActivity();
  if (!active.length) return null;
  return <aside aria-label="Atlas-Aktivität" className="shrink-0 border-b border-(--border) bg-(--surface) px-4 py-2 sm:px-5">
    {active.map(({ chat, run }) => <div key={chat.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-1 text-sm sm:flex sm:items-center">
      {run.status === "running" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-700 motion-reduce:animate-none dark:text-brand-300" aria-hidden="true" /> : <MessageCircleQuestion className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />}
      <Link to={`/atlas/${chat.id}`} className="min-w-0 flex-1 rounded-md focus-visible:focus-ring">
        <span className="font-medium" role="status">{run.status === "running" ? "Atlas arbeitet" : "Atlas wartet auf dich"}{run.workArea ? ` · ${run.workArea.label}` : " · Gespräch"}</span>
        <span className="block text-xs break-words text-(--text-muted) sm:max-w-lg sm:truncate">{run.status === "running" ? run.activity || "Antwort wird vorbereitet" : "Antwort oder Bestätigung im Gespräch erforderlich"} · {chat.title}</span>
      </Link>
      <div className="col-start-2 flex flex-wrap gap-x-3 gap-y-1 sm:ml-auto">
        {run.workArea ? <Link to={run.workArea.path} className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-brand-700 hover:underline focus-visible:focus-ring dark:text-brand-300">Bereich öffnen <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : null}
        <Link to={`/atlas/${chat.id}`} className="rounded-md px-1 py-1 text-xs font-medium text-brand-700 hover:underline focus-visible:focus-ring dark:text-brand-300">Gespräch öffnen</Link>
      </div>
    </div>)}
  </aside>;
}
