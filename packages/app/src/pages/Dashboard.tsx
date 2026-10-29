import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarClock, Camera, Check, CheckCircle2, CheckSquare, Contact2, Eye, FileSignature, Flag, FolderOpen, Hammer, Landmark, LayoutGrid, PackageMinus, Plus, ReceiptText, Timer, Users, Zap } from "lucide-react";
import { can, overview, upcomingUvaDeadlines, daysUntil, turnoverForYear, constantsFor, computeE1a, computeL1, todayIso, type Role, type Vault } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { Badge, Button, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { MonthlyChart, CategoryDonut } from "@/components/charts";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { CategoryIcon } from "@/lib/icons";
import { TransactionDialog } from "@/components/TransactionForm";
import { isMobile, isTauri } from "@/platform";
import { IntakeButton, useIntake } from "@/components/Intake";
import { useInstalledModules, useMe } from "@/modules/registry";
import { OWNER_PLACEHOLDER } from "@/modules/basis/team/owner";
import { useAtlasReadiness } from "@/atlas/hooks";

export default function Dashboard() {
  const profile = useProfile();
  const vault = useVault();
  const installed = useInstalledModules();
  const { member, role } = useMe();
  const summa = installed.some((m) => m.id === "summa") && can(role, "summa", "read");
  // more than Ordo: projects, stock, production … get the "Heute" strip on top
  const more = installed.some((m) => m.id !== "basis" && m.id !== "summa");
  const widgets = installed.flatMap((m) => (m.dashboardWidgets ?? []).filter((w) => !w.modes || w.modes.includes(profile.mode)));
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 11 ? "Guten Morgen" : h < 18 ? "Servus" : "Guten Abend";
  })();
  // greet the person, not the company
  const memberName = member && member.name !== OWNER_PLACEHOLDER ? member.name : "";
  const firstName = (memberName || vault.profiles.find((p) => !p.deletedAt && p.mode === "employee")?.name || profile.company.owner || "").trim().split(/\s+/)[0];
  const widgetGrid = widgets.length ? (
    <div className="grid gap-5 lg:grid-cols-2">
      {widgets.map((w) => <div key={w.id} className={cls("flex min-w-0 flex-col *:flex-1", w.wide && "lg:col-span-2")}>{w.element}</div>)}
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        subtitle={`${fmtDate(todayIso(), { long: true })} · ${profile.company.name || profile.name}`}
      />
      <SetupSteps />
      {more ? <TodayStrip withSumma={!summa} /> : null}
      {summa ? <SummaOverview widgetGrid={widgetGrid} /> : widgetGrid ?? (more ? null : <BasisStart />)}
    </div>
  );
}

/**
 * Ordo is built to run on the person's own AI subscription: connect it once (and, on the desktop, the folders
 * where invoices land) and the rest happens by itself. Shown until both are done.
 */
function SetupSteps() {
  const vault = useVault();
  const profile = useProfile();
  const navigate = useNavigate();
  const atlas = useAtlasReadiness();
  const steps = [
    { id: "ai", done: atlas.ok, title: "KI-Abo verbinden", body: "Dein ChatGPT-Abo (Desktop-App) oder ein API-Key von Claude bzw. OpenAI. Damit liest Ordo Rechnungen und Atlas erledigt die Arbeit für dich.", to: "/einstellungen/atlas", action: "Verbinden" },
    ...(isTauri ? [{ id: "folders", done: vault.settings.watchFolders.some((f) => f.profileId === profile.id), title: "Ordner verbinden", body: "Die Ordner, in denen deine Rechnungen und Kontoauszüge landen. Neue Dateien holt Ordo dann selbst.", to: "/einstellungen/ordner", action: "Ordner wählen" }] : []),
  ];
  if (steps.every((x) => x.done)) return null;
  return (
    <section className="surface p-5">
      <div className="text-[15px] font-semibold">{steps.length > 1 ? "Zwei Schritte, dann läuft Ordo von selbst" : "Ein Schritt, dann läuft Ordo von selbst"}</div>
      <ol className="mt-3 grid gap-3 md:grid-cols-2">
        {steps.map((x, i) => (
          <li key={x.id} className={cls("flex items-start gap-3 rounded-xl border border-(--border) p-3", x.done && "opacity-60")}>
            <span className={cls("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold", x.done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-brand-700 text-white")}>{x.done ? <Check className="h-4 w-4" /> : i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{x.title}</div>
              <p className="mt-0.5 text-xs text-(--text-muted)">{x.body}</p>
            </div>
            {!x.done ? <Button size="sm" onClick={() => navigate(x.to)}>{x.action}</Button> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The Ordo part of the Übersicht – unchanged look for Ordo-only workspaces. */
function SummaOverview({ widgetGrid }: { widgetGrid: ReactNode }) {
  const profile = useProfile();
  const vault = useVault();
  const transactions = useList("transactions");
  const documents = useList("documents");
  const invoices = useList("invoices");
  const contacts = useList("contacts");
  const assets = useList("assets");
  const navigate = useNavigate();
  const [quickAdd, setQuickAdd] = useState(false);
  const year = new Date().getFullYear();

  const ov = useMemo(() => overview(profile, transactions, vault.categories, contacts, documents, invoices), [profile, transactions, vault.categories, contacts, documents, invoices]);
  const deadlines = useMemo(() => upcomingUvaDeadlines(profile), [profile]);
  const turnover = useMemo(() => turnoverForYear(profile, year, transactions), [profile, year, transactions]);
  const c = constantsFor(year);
  const taxPreview = useMemo(() => {
    if (profile.mode === "business") {
      const r = computeE1a(profile, year, transactions, vault.categories, assets);
      return { label: `Gewinn ${year} (geschätzt)`, value: r.gewinnCents, sub: `Einnahmen ${fmtMoney(r.einnahmenCents)} · Ausgaben ${fmtMoney(r.ausgabenCents + r.pauschaleCents)}` };
    }
    const r = computeL1(profile, year, transactions, vault.categories, vault.settings.employee[profile.id]);
    return { label: "Steuergutschrift (geschätzt)", value: r.estimatedRefundCents, sub: `Werbungskosten ${fmtMoney(r.werbungskostenCents)} · Belastungen ${fmtMoney(r.agbMitSelbstbehaltCents)}` };
  }, [profile, year, transactions, vault.categories, assets, vault.settings.employee]);

  const intake = useIntake();
  const openItems = ov.reviewCount + ov.inboxCount;
  const autoBooked = documents.filter((d) => d.autoBooked && d.status === "approved" && d.importedAt.startsWith(String(year))).length;
  const monthDelta = ov.prevExpenseMonthCents ? (ov.expenseMonthCents - ov.prevExpenseMonthCents) / ov.prevExpenseMonthCents : null;

  return (
    <>
      <section className="surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className={openItems ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"}>
          {openItems ? <Eye className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{openItems ? `${openItems} ${openItems === 1 ? "Rechnung braucht" : "Rechnungen brauchen"} einen kurzen Blick` : "Alles erledigt"}</div>
          <p className="mt-0.5 text-sm text-(--text-muted)">
            {openItems ? "Ordo war sich bei ein paar Angaben nicht sicher. Kurz prüfen, dann ist alles gebucht." : intake.canScan ? "Neue Rechnungen in deinen Ordnern holt Ordo mit einem Klick." : "Neue Rechnungen hochladen oder einfach ins Fenster ziehen – Ordo liest und bucht sie selbst."}
            {autoBooked ? <span className="ml-1 inline-flex items-center gap-1 whitespace-nowrap"><Zap className="h-3.5 w-3.5 text-brand-600" />{autoBooked} heuer automatisch gebucht.</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {openItems ? <Button onClick={() => navigate("/belege")}>Jetzt prüfen <ArrowRight className="h-4 w-4" /></Button> : null}
          {isMobile ? <Button variant={openItems ? "outline" : "primary"} onClick={() => void intake.upload(true)}><Camera className="h-4 w-4" /> Fotografieren</Button> : null}
          {openItems || isMobile ? <Button variant="outline" onClick={() => void intake.run()} loading={intake.busy}>{intake.label}</Button> : <IntakeButton />}
          <Button variant="ghost" onClick={() => setQuickAdd(true)}><Plus className="h-4 w-4" /> Von Hand</Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Einnahmen ${year}`} value={fmtMoney(ov.incomeYtdCents)} sub={`Diesen Monat ${fmtMoney(ov.incomeMonthCents)}`} tone={ov.incomeYtdCents ? "up" : undefined} />
        <Stat label={`Ausgaben ${year}`} value={fmtMoney(ov.expenseYtdCents)} sub={monthDelta !== null ? <span className={monthDelta > 0 ? "text-red-600" : "text-emerald-600"}>{monthDelta > 0 ? <ArrowUpRight className="inline h-3 w-3" /> : <ArrowDownRight className="inline h-3 w-3" />} {fmtPct(Math.abs(monthDelta))} vs. Vormonat</span> : `Diesen Monat ${fmtMoney(ov.expenseMonthCents)}`} />
        <Stat label={profile.mode === "business" ? "Ergebnis" : "Übrig"} value={fmtMoney(ov.netYtdCents)} sub={ov.savingsRate !== null ? `${profile.mode === "business" ? "Marge" : "Sparquote"} ${fmtPct(ov.savingsRate)}` : undefined} tone={ov.netYtdCents > 0 ? "up" : ov.netYtdCents < 0 ? "down" : undefined} />
        <Stat label={taxPreview.label} value={fmtMoney(taxPreview.value)} sub={taxPreview.sub} />
      </div>

      {widgetGrid}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={`Monatsverlauf ${year}`} className="lg:col-span-2" fill>
          {ov.transactionCount ? <MonthlyChart data={ov.months} grow /> : <EmptyState bare title="Hier entsteht dein Jahr" body="Sobald die erste Rechnung gebucht ist, siehst du Monat für Monat, was rein- und rausgeht." action={<IntakeButton />} />}
        </Card>
        <Card title="Wofür du Geld ausgibst">
          <CategoryDonut data={ov.expenseByCategory} />
          <ul className="mt-2 space-y-1.5">
            {ov.expenseByCategory.slice(0, 5).map((c) => (
              <li key={c.categoryId ?? "none"} className="flex items-center gap-2 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded text-white" style={{ background: c.color }}><CategoryIcon name={c.icon} className="h-3 w-3" /></span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="tabular text-(--text-muted)">{fmtPct(c.pct)}</span>
                <span className="tabular font-medium">{fmtMoney(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Was ansteht">
          <ul className="space-y-3 text-sm">
            {deadlines.map((d) => {
              const days = daysUntil(d.dueDate);
              return (
                <li key={d.label} className="flex items-start gap-3">
                  <CalendarClock className="mt-0.5 h-4 w-4 text-brand-600" />
                  <div className="flex-1">
                    <div className="font-medium">Umsatzsteuer-Voranmeldung {d.label}</div>
                    <div className="text-xs text-(--text-muted)">Fällig {fmtDate(d.dueDate)} {d.to >= todayIso() ? "(Zeitraum läuft)" : days < 0 ? "(überfällig!)" : `(in ${days} Tagen)`}</div>
                  </div>
                  <Link to={`/steuern/uva?year=${d.ref.year}&index=${d.ref.index}`} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Öffnen</Link>
                </li>
              );
            })}
            {profile.mode === "business" && profile.vatRegime === "kleinunternehmer" ? (
              <li className="flex items-start gap-3">
                <Landmark className="mt-0.5 h-4 w-4 text-brand-600" />
                <div className="flex-1">
                  <div className="font-medium">Kleinunternehmergrenze</div>
                  <div className="text-xs text-(--text-muted)">{fmtMoney(turnover.grossCents)} von {c.kleinunternehmerGrenze.toLocaleString("de-AT")} € ({fmtPct(turnover.grossCents / (c.kleinunternehmerGrenze * 100))})</div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-(--surface-2)"><div className={`h-full ${turnover.grossCents > c.kleinunternehmerGrenze * 100 * 0.9 ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${Math.min(100, (turnover.grossCents / (c.kleinunternehmerGrenze * 100)) * 100)}%` }} /></div>
                </div>
              </li>
            ) : null}
            {profile.mode === "employee" ? (
              <li className="flex items-start gap-3">
                <Landmark className="mt-0.5 h-4 w-4 text-brand-600" />
                <div className="flex-1">
                  <div className="font-medium">Arbeitnehmerveranlagung {year - 1}</div>
                  <div className="text-xs text-(--text-muted)">Geht bis 31.12.{year + 4} rückwirkend. Alle Werte findest du unter Steuern.</div>
                </div>
              </li>
            ) : null}
            {ov.overdueInvoices ? <li className="flex items-start gap-3"><Badge tone="danger">!</Badge><div className="flex-1"><div className="font-medium">{ov.overdueInvoices} überfällige Rechnung{ov.overdueInvoices === 1 ? "" : "en"}</div><div className="text-xs text-(--text-muted)">Offen: {fmtMoney(ov.openInvoicesCents)}</div></div><Link to="/rechnungen" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Ansehen</Link></li> : null}
            {ov.unpaidExpensesCents ? <li className="flex items-start gap-3"><Badge tone="warning">€</Badge><div className="flex-1"><div className="font-medium">Noch zu bezahlen</div><div className="text-xs text-(--text-muted)">{fmtMoney(ov.unpaidExpensesCents)} noch nicht bezahlt</div></div></li> : null}
            {!deadlines.length && !ov.overdueInvoices && !ov.unpaidExpensesCents && profile.mode === "business" ? <li className="text-(--text-muted)">Keine offenen Fristen.</li> : null}
          </ul>
        </Card>
        <Card title="Zuletzt gebucht" className="lg:col-span-2" action={<Link to="/buchungen" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Alle anzeigen</Link>}>
          <RecentTransactions />
        </Card>
      </div>
      <TransactionDialog open={quickAdd} onClose={() => setQuickAdd(false)} />
    </>
  );
}

function RecentTransactions() {
  const txs = useList("transactions");
  const vault = useVault();
  const contacts = useList("contacts");
  const cats = useMemo(() => new Map(vault.categories.map((c) => [c.id, c])), [vault.categories]);
  const cons = useMemo(() => new Map(contacts.map((c) => [c.id, c.name])), [contacts]);
  const recent = useMemo(() => [...txs].sort((a, b) => (b.paidDate ?? b.date).localeCompare(a.paidDate ?? a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 8), [txs]);
  if (!recent.length) return <div className="py-6 text-center text-sm text-(--text-muted)">Noch nichts gebucht.</div>;
  return (
    <ul className="divide-y divide-(--border)">
      {recent.map((t) => {
        const c = t.categoryId ? cats.get(t.categoryId) : undefined;
        return (
          <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: c?.color ?? "#94a3b8" }}><CategoryIcon name={c?.icon ?? "help-circle"} className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{t.description || c?.name || "Buchung"}</span>{!t.reviewed ? <Badge tone="warning" className="shrink-0">ungeprüft</Badge> : null}</div>
              <div className="truncate text-xs text-(--text-muted)">{fmtDate(t.date)}{t.contactId ? ` · ${cons.get(t.contactId) ?? ""}` : ""}{c ? ` · ${c.name}` : ""}</div>
            </div>
            <div className={`tabular font-semibold ${t.kind === "income" ? "text-emerald-700 dark:text-emerald-400" : t.kind === "transfer" ? "text-(--text-muted)" : ""}`}>{t.kind === "income" ? "+" : t.kind === "transfer" ? "" : "−"}{fmtMoney(t.grossCents)}</div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* "Heute" – what needs you today, across modules                      */
/* ------------------------------------------------------------------ */

interface TodayItem {
  key: string;
  to: string;
  icon: ReactNode;
  label: string;
  tone?: "live" | "warning";
}

const fmtElapsed = (min: number) => (min < 60 ? `${min} Min.` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function todayItems(vault: Vault, profileId: string, has: (id: string) => boolean, meId: string | undefined, role: Role, now: Date, withSumma: boolean): TodayItem[] {
  const today = todayIso(now);
  const inAWeek = todayIso(new Date(now.getTime() + 7 * 86_400_000));
  const mine = <T extends { profileId: string; deletedAt?: string }>(list: T[]) => list.filter((x) => !x.deletedAt && x.profileId === profileId);
  const items: TodayItem[] = [];
  const icon = "h-4 w-4";

  if (has("projekte") && can(role, "time", "own")) {
    const timers = vault.settings.timers;
    const timer = meId ? timers.find((t) => t.memberId === meId) ?? timers.find((t) => !t.memberId) : timers[0];
    if (timer) {
      const project = vault.projects.find((p) => p.id === timer.projectId);
      const min = Math.max(0, Math.floor((now.getTime() - new Date(timer.startedAt).getTime()) / 60_000));
      items.push({ key: "timer", to: "/zeiten", icon: <Timer className={icon} />, label: `Stoppuhr läuft · ${fmtElapsed(min)}${project ? ` · ${project.name}` : ""}`, tone: "live" });
    }
  }
  if (has("projekte") && can(role, "projects", "read")) {
    const team = vault.members.filter((m) => !m.deletedAt && m.active).length;
    const forMe = (ids: string[]) => !meId || team <= 1 || ids.includes(meId);
    const open = mine(vault.tasks).filter((t) => t.status !== "done" && t.dueDate && t.dueDate <= today && forMe(t.assigneeIds));
    const dueToday = open.filter((t) => t.dueDate === today).length;
    const overdue = open.length - dueToday;
    if (dueToday) items.push({ key: "tasks", to: "/aufgaben", icon: <CheckSquare className={icon} />, label: `${plural(dueToday, "Aufgabe", "Aufgaben")} für heute` });
    if (overdue) items.push({ key: "overdue", to: "/aufgaben", icon: <CheckSquare className={icon} />, label: `${plural(overdue, "Aufgabe", "Aufgaben")} überfällig`, tone: "warning" });
    const milestones = mine(vault.milestones).filter((m) => m.status === "open" && m.dueDate && m.dueDate <= inAWeek).length;
    if (milestones) items.push({ key: "milestones", to: "/projekte", icon: <Flag className={icon} />, label: `${plural(milestones, "Meilenstein", "Meilensteine")} bis nächste Woche` });
  }
  if (has("projekte") && can(role, "offers", "read")) {
    const expiring = mine(vault.offers).filter((o) => o.status === "sent" && o.validUntil && o.validUntil >= today && o.validUntil <= inAWeek).length;
    if (expiring) items.push({ key: "offers", to: "/angebote", icon: <FileSignature className={icon} />, label: `${plural(expiring, "Angebot läuft", "Angebote laufen")} bald ab` });
  }
  // when the Ordo part is shown below, it already tells about invoices to check
  if (withSumma && has("summa") && can(role, "summa", "read")) {
    const review = mine(vault.documents).filter((d) => d.status === "review" || d.status === "inbox").length;
    if (review) items.push({ key: "review", to: "/belege", icon: <ReceiptText className={icon} />, label: `${plural(review, "Rechnung", "Rechnungen")} kurz prüfen`, tone: "warning" });
    const overdueInv = mine(vault.invoices).filter((i) => (i.status === "sent" || i.status === "overdue") && i.dueDate < today).length;
    if (overdueInv) items.push({ key: "invoices", to: "/rechnungen", icon: <ReceiptText className={icon} />, label: `${plural(overdueInv, "Rechnung", "Rechnungen")} nicht bezahlt`, tone: "warning" });
  }
  if (has("produkte") && can(role, "products", "read")) {
    const stock = new Map<string, number>();
    for (const m of mine(vault.stockMoves)) stock.set(m.productId, (stock.get(m.productId) ?? 0) + m.quantity);
    const low = mine(vault.products).filter((p) => p.active && p.trackStock && p.minStock > 0 && (stock.get(p.id) ?? 0) < p.minStock).length;
    if (low) items.push({ key: "stock", to: "/lager", icon: <PackageMinus className={icon} />, label: `${plural(low, "Artikel", "Artikel")} unter Mindestbestand`, tone: "warning" });
  }
  if (has("produktion") && can(role, "production", "read")) {
    const due = mine(vault.workOrders).filter((w) => w.status !== "done" && w.status !== "cancelled" && w.dueDate && w.dueDate <= today).length;
    if (due) items.push({ key: "workorders", to: "/produktion", icon: <Hammer className={icon} />, label: `${plural(due, "Fertigungsauftrag", "Fertigungsaufträge")} fällig` });
  }
  return items;
}

function TodayStrip({ withSumma }: { withSumma: boolean }) {
  const vault = useVault();
  const profile = useProfile();
  const installed = useInstalledModules();
  const { member, role } = useMe();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const items = useMemo(() => todayItems(vault, profile.id, (id) => installed.some((m) => m.id === id), member?.id, role, now, withSumma), [vault, profile.id, installed, member?.id, role, now, withSumma]);
  return (
    <section className="surface flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="shrink-0 text-[15px] font-semibold sm:w-20">Heute</div>
      {items.length ? (
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {items.map((i) => (
            <Link
              key={i.key}
              to={i.to}
              className={
                i.tone === "live"
                  ? "inline-flex max-w-full items-center gap-2 rounded-xl bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-200"
                  : i.tone === "warning"
                    ? "inline-flex max-w-full items-center gap-2 rounded-xl bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 dark:bg-amber-900/25 dark:text-amber-100"
                    : "inline-flex max-w-full items-center gap-2 rounded-xl bg-(--surface-2) px-3 py-1.5 text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
              }
            >
              {i.tone === "live" ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-600" /> : i.icon}
              <span className="truncate">{i.label}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-(--text-muted)">Nichts Dringendes. Ein guter Moment, um vorauszuarbeiten.</p>
      )}
    </section>
  );
}

/** Workspace without Ordo and without other modules: a calm starting point. */
function BasisStart() {
  const tiles = [
    { to: "/kontakte?neu=1", icon: <Contact2 className="h-5 w-5" />, title: "Kontakte", body: "Kunden und Lieferanten mit Ansprechpartnern" },
    { to: "/dateien", icon: <FolderOpen className="h-5 w-5" />, title: "Dateien", body: "Pläne, Verträge und Fotos an einem Ort" },
    { to: "/team", icon: <Users className="h-5 w-5" />, title: "Team", body: "Wer mitarbeitet, mit Rollen und Stundensätzen" },
    { to: "/module", icon: <LayoutGrid className="h-5 w-5" />, title: "Module", body: "Buchhaltung, Projekte, Lager oder Produktion dazunehmen" },
  ];
  return (
    <Card title="Los geht’s">
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="flex items-start gap-3 rounded-2xl border border-(--border) p-4 hover:bg-(--surface-2)">
            <span className="text-brand-700 dark:text-brand-400">{t.icon}</span>
            <span className="min-w-0">
              <span className="block font-medium">{t.title}</span>
              <span className="block text-sm text-(--text-muted)">{t.body}</span>
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
