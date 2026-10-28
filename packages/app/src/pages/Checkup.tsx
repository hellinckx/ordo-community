import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Loader2, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { runAllCheck, todayIso, type CheckFinding } from "@ordo/core";
import { useProfile, useSettingsMutator, useVault } from "@/state/hooks";
import { Button, PageHeader, Select } from "@/components/ui";
import { cls, fmtDateTime } from "@/lib/format";
import { checkScopeFor, runFullCheck, useAllCheck } from "@/services/allCheck";
import { useMe } from "@/modules/registry";
import { useAskAtlas } from "@/atlas/hooks";

const LOOK = {
  error: { icon: XCircle, box: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300", label: "Fehler" },
  warning: { icon: AlertTriangle, box: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", label: "Prüfen" },
  info: { icon: Info, box: "border-(--border) bg-(--surface)", text: "text-(--text-muted)", label: "Hinweis" },
} as const;

/** /pruefung – Der Alles-Check: what is not right in the bookkeeping, errors in red, with a way to fix each. */
export default function Checkup() {
  const vault = useVault();
  const profile = useProfile();
  const navigate = useNavigate();
  const askAtlas = useAskAtlas();
  const mutate = useSettingsMutator();
  const { running, step } = useAllCheck();
  const settings = vault.settings.allCheck;
  // the rules are cheap: the page always shows the current state, "Jetzt prüfen" also syncs and reads folders first
  const { role } = useMe();
  const result = useMemo(() => runAllCheck(vault, profile.id, todayIso(), checkScopeFor(role)), [vault, profile.id, role]);
  // what was fixed counts at once: the number in the sidebar follows the current state while the page is open
  useEffect(() => {
    if (result.errors !== settings.lastErrors || result.warnings !== settings.lastWarnings) mutate((s) => ({ ...s, allCheck: { ...s.allCheck, lastErrors: result.errors, lastWarnings: result.warnings } }));
  }, [result.errors, result.warnings]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alles-Check"
        subtitle="Prüft Buchungen, Rechnungen, Kontoauszüge und Projekte nach festen Regeln – ohne KI. Was rechtlich nicht passt, steht rot ganz oben."
        actions={
          <>
            <Button variant="outline" onClick={() => void askAtlas("Geh den Alles-Check mit mir durch: Was ist am wichtigsten, und was kannst du davon gleich für mich erledigen? Frag nach, bevor du etwas änderst.")}><Sparkles className="h-4 w-4" /> Mit Atlas durchgehen</Button>
            <Button loading={running} onClick={() => void runFullCheck()}><ShieldCheck className="h-4 w-4" /> Jetzt prüfen</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-(--text-muted)">
        {running ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {step} …</span> : <span>{settings.lastRunAt ? `Zuletzt ganz geprüft: ${fmtDateTime(settings.lastRunAt)}` : "Noch nie ganz geprüft"}</span>}
        <label className="inline-flex flex-wrap items-center gap-2">
          Automatisch, solange Ordo offen ist:
          <Select value={settings.interval} onChange={(e) => mutate((s) => ({ ...s, allCheck: { ...s.allCheck, interval: e.target.value as typeof settings.interval } }))} className="h-8 w-44 shrink-0 text-sm">
            <option value="daily">einmal am Tag</option>
            <option value="weekly">einmal pro Woche</option>
            <option value="off">aus</option>
          </Select>
        </label>
      </div>

      {!result.findings.length ? (
        <div className="surface flex items-center gap-3 p-5">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
          <div>
            <div className="font-medium">Alles in Ordnung</div>
            <div className="text-sm text-(--text-muted)">Jede Ausgabe hat ihre Rechnung, die Beträge stimmen und nichts wartet auf dich.</div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {result.findings.map((f) => <FindingCard key={f.id} f={f} onOpen={() => f.link && navigate(f.link)} />)}
        </div>
      )}
      <p className="text-xs text-(--text-muted)">Der Alles-Check ersetzt keine Steuerberatung. Er findet, was nach den üblichen Regeln fehlt oder nicht zusammenpasst – entscheiden musst du selbst.</p>
    </div>
  );
}

function FindingCard({ f, onOpen }: { f: CheckFinding; onOpen: () => void }) {
  const look = LOOK[f.level];
  const Icon = look.icon;
  return (
    <div className={cls("flex flex-col gap-3 rounded-2xl border p-4", look.box)}>
      <div className="flex items-start gap-3">
        <Icon className={cls("mt-0.5 h-5 w-5 shrink-0", look.text)} />
        <div className="min-w-0 flex-1">
          <div className={cls("text-[11px] font-semibold tracking-wide uppercase", look.text)}>{look.label}</div>
          <div className="mt-0.5 font-medium">{f.title}</div>
          <p className="mt-1 text-sm text-(--text-muted)">{f.detail}</p>
        </div>
      </div>
      {f.link ? <div className="flex justify-end"><Button size="sm" variant="outline" onClick={onOpen}>Ansehen <ArrowRight className="h-4 w-4" /></Button></div> : null}
    </div>
  );
}
