import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight, CalendarClock, Factory } from "lucide-react";
import { isWorkOrderOpen, workOrderProgress } from "@ordo/core";
import { useList } from "@/state/hooks";
import { Card, Progress } from "@/components/ui";
import { cls } from "@/lib/format";
import { fmtQty, useProducts } from "@/modules/produkte/shared";
import { dueInfo, StatusBadge, useProductionAccess, weekRange } from "./shared";

/** Übersicht card: open work orders and what is due this week. */
export function ProductionWidget() {
  const workOrders = useList("workOrders");
  const products = useProducts();
  const access = useProductionAccess();
  const week = weekRange();
  const open = useMemo(() => workOrders.filter(isWorkOrderOpen).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")), [workOrders]);
  const dueThisWeek = open.filter((w) => w.dueDate && w.dueDate <= week.to);
  const overdue = open.filter((w) => dueInfo(w)?.tone === "danger");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  if (!access.canRead) return null;

  return (
    <Card title="Fertigung" action={<Link to="/produktion" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline dark:text-brand-400">Alle Aufträge <ArrowRight className="h-3.5 w-3.5" /></Link>}>
      {!open.length ? (
        <div className="flex items-start gap-3 text-sm">
          <Factory className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" />
          <p className="text-(--text-muted)">Keine offenen Fertigungsaufträge.{access.canWrite ? <> <Link to="/produktion?neu=1" className="text-brand-700 hover:underline dark:text-brand-400">Neuen anlegen</Link></> : null}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <div className="text-xs text-(--text-muted)">Offen</div>
              <div className="tabular text-xl font-semibold tracking-tight">{open.length}</div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted)">Diese Woche fällig</div>
              <div className="tabular text-xl font-semibold tracking-tight">{dueThisWeek.length}</div>
            </div>
            {overdue.length ? (
              <div>
                <div className="text-xs text-(--text-muted)">Überfällig</div>
                <div className="tabular text-xl font-semibold tracking-tight text-red-600 dark:text-red-400">{overdue.length}</div>
              </div>
            ) : null}
          </div>
          <ul className="space-y-2.5">
            {open.slice(0, 4).map((w) => {
              const p = byId.get(w.productId);
              const due = dueInfo(w);
              const prog = workOrderProgress(w);
              return (
                <li key={w.id}>
                  <Link to={`/produktion/${w.id}`} className="block rounded-lg text-sm hover:bg-(--surface-2) -mx-2 px-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{p?.name ?? "–"} <span className="font-normal text-(--text-muted)">× {fmtQty(w.quantity)}</span></span>
                      <StatusBadge status={w.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <Progress value={prog.ratio} className="h-1.5" />
                      {due ? <span className={cls("inline-flex shrink-0 items-center gap-1 text-xs", due.tone === "danger" ? "text-red-600 dark:text-red-400" : due.tone === "warning" ? "text-amber-700 dark:text-amber-400" : "text-(--text-muted)")}><CalendarClock className="h-3 w-3" />{due.label}</span> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
