import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Clock, FileSignature, Lock, Plus, Search } from "lucide-react";
import { isOfferExpiringSoon, offerDaysLeft, offerDisplayStatus, offerTotals, todayIso, type Offer, type OfferStatus } from "@ordo/core";
import { useContactMap, useList, useProfile } from "@/state/hooks";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Stat, Tabs } from "@/components/ui";
import { cls, fmtDate, fmtMoney } from "@/lib/format";
import { OFFER_STATUS, projectLabel, useOfferRights } from "./shared";
import { OfferEditorRoute } from "./OfferEditor";

/** /angebote and /angebote/:id – list of offers and the offer editor. */
export default function OffersPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rights = useOfferRights();

  // "+ Neu → Angebot" and project pages land here with ?neu=1 (optionally &projekt=<id>)
  const wantsNew = !id && params.get("neu") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    const projekt = params.get("projekt");
    navigate(`/angebote/neu${projekt ? `?projekt=${encodeURIComponent(projekt)}` : ""}`, { replace: true });
  }, [wantsNew]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rights.canRead) {
    return (
      <div className="space-y-4">
        <PageHeader title="Angebote" />
        <EmptyState icon={<Lock className="h-8 w-8" />} title="Kein Zugriff" body="Deine Rolle im Team darf Angebote nicht sehen. Frag die Inhaberin oder den Inhaber, wenn du sie brauchst." />
      </div>
    );
  }
  if (id) return <OfferEditorRoute id={id} />;
  if (wantsNew) return null;
  return <OfferList />;
}

type StatusFilter = "all" | OfferStatus;
type Period = "all" | "30" | "90" | "year";

function OfferList() {
  const offers = useList("offers");
  const projects = useList("projects");
  const contacts = useContactMap();
  const profile = useProfile();
  const navigate = useNavigate();
  const rights = useOfferRights();
  const today = todayIso();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [customer, setCustomer] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [q, setQ] = useState("");
  const ku = profile.vatRegime === "kleinunternehmer";

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const rows = useMemo(
    () =>
      offers
        .map((o) => ({ offer: o, shown: offerDisplayStatus(o, today), net: offerTotals(o, { kleinunternehmer: ku }).netCents }))
        .sort((a, b) => b.offer.date.localeCompare(a.offer.date) || b.offer.number.localeCompare(a.offer.number)),
    [offers, today, ku],
  );

  const from = period === "30" ? shift(today, -30) : period === "90" ? shift(today, -90) : period === "year" ? `${today.slice(0, 4)}-01-01` : "";
  const scoped = rows.filter((r) => (!customer || r.offer.customerId === customer) && (!from || r.offer.date >= from));
  const needle = q.trim().toLowerCase();
  const visible = scoped.filter((r) => {
    if (status !== "all" && r.shown !== status) return false;
    if (!needle) return true;
    const o = r.offer;
    const hay = [o.number, o.subject, o.customerId ? contacts.get(o.customerId)?.name : "", projectLabel(o.projectId ? projectMap.get(o.projectId) : undefined), OFFER_STATUS[r.shown].label].join(" ").toLowerCase();
    return hay.includes(needle);
  });

  const count = (s: OfferStatus) => scoped.filter((r) => r.shown === s).length;
  const sum = (list: typeof scoped) => list.reduce((s, r) => s + r.net, 0);
  const accepted = scoped.filter((r) => r.shown === "accepted");
  const sent = scoped.filter((r) => r.shown === "sent");
  const decided = scoped.filter((r) => r.shown === "accepted" || r.shown === "declined" || r.shown === "expired");
  const expiring = rows.filter((r) => isOfferExpiringSoon(r.offer, today)).sort((a, b) => (a.offer.validUntil ?? "").localeCompare(b.offer.validUntil ?? ""));
  const customersWithOffers = useMemo(() => {
    const idsSet = new Set(offers.map((o) => o.customerId).filter(Boolean) as string[]);
    return [...idsSet].map((id) => contacts.get(id)).filter((c): c is NonNullable<typeof c> => !!c).sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [offers, contacts]);

  const newButton = rights.canWrite ? (
    <Button onClick={() => navigate("/angebote/neu")}>
      <Plus className="h-4 w-4" /> Neues Angebot
    </Button>
  ) : null;

  if (!offers.length) {
    return (
      <div className="space-y-4">
        <PageHeader title="Angebote" subtitle="Angebote an deine Kunden – als PDF, und angenommen mit einem Klick zur Rechnung." actions={newButton} />
        <EmptyState
          icon={<FileSignature className="h-8 w-8" />}
          title="Noch keine Angebote"
          body="Schreib dein erstes Angebot: Positionen eintippen oder aus Excel einfügen, PDF speichern und verschicken. Wird es angenommen, machst du daraus mit einem Klick die Rechnung."
          action={newButton}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Angebote" subtitle="Angebote an deine Kunden – als PDF, und angenommen mit einem Klick zur Rechnung." actions={newButton} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
        <Stat label="Entwürfe" value={count("draft")} />
        <Stat label="Versendet" value={count("sent")} sub={sent.length ? `${fmtMoney(sum(sent))} netto offen` : undefined} />
        <Stat label="Angenommen" value={count("accepted")} sub={accepted.length ? `${fmtMoney(sum(accepted))} netto` : undefined} />
        <Stat label="Volumen netto" value={fmtMoney(sum(scoped))} sub={`${scoped.length} Angebot${scoped.length === 1 ? "" : "e"}`} />
        <div className="col-span-2 sm:col-span-1"><Stat label="Erfolgsquote" value={decided.length ? `${Math.round((accepted.length / decided.length) * 100)} %` : "–"} sub={decided.length ? `${accepted.length} von ${decided.length} entschiedenen` : "Noch nichts entschieden"} /></div>
      </div>

      {expiring.length ? (
        <Card title={<span className="flex items-center gap-2"><Clock className="h-4 w-4 text-(--text-muted)" /> Läuft bald ab</span>} padded={false}>
          <ul className="divide-y divide-(--border)">
            {expiring.slice(0, 5).map(({ offer: o, net }) => {
              const days = offerDaysLeft(o, today) ?? 0;
              return (
                <li key={o.id}>
                  <button type="button" onClick={() => navigate(`/angebote/${o.id}`)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-(--surface-2)">
                    <span className="font-medium tabular">{o.number}</span>
                    <span className="min-w-0 flex-1 truncate text-(--text-muted)">{(o.customerId && contacts.get(o.customerId)?.name) || o.subject || "–"}</span>
                    <span className="hidden tabular sm:inline">{fmtMoney(net)}</span>
                    <Badge tone="warning">{days === 0 ? "heute" : days === 1 ? "noch 1 Tag" : `noch ${days} Tage`}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="space-y-3">
        <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <Tabs<StatusFilter>
          className="w-max flex-nowrap"
          value={status}
          onChange={setStatus}
          tabs={[
            { id: "all", label: "Alle" },
            { id: "draft", label: "Entwürfe" },
            { id: "sent", label: "Versendet" },
            { id: "accepted", label: "Angenommen" },
            { id: "declined", label: "Abgelehnt" },
            { id: "expired", label: "Abgelaufen" },
          ]}
        />
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_170px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nummer, Kunde, Betreff …" className="pl-9" />
          </div>
          <Select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Kunde">
            <option value="">Alle Kunden</option>
            {customersWithOffers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Zeitraum">
            <option value="all">Jederzeit</option>
            <option value="30">Letzte 30 Tage</option>
            <option value="90">Letzte 90 Tage</option>
            <option value="year">Dieses Jahr</option>
          </Select>
        </div>
      </div>

      {!visible.length ? (
        <EmptyState icon={<Search className="h-7 w-7" />} title="Nichts gefunden" body="Kein Angebot passt zu diesen Filtern." action={<Button variant="outline" size="sm" onClick={() => { setStatus("all"); setCustomer(""); setPeriod("all"); setQ(""); }}>Filter zurücksetzen</Button>} />
      ) : (
        <div className="surface overflow-hidden">
          {/* phone: simple list */}
          <ul className="divide-y divide-(--border) sm:hidden">
            {visible.map(({ offer: o, shown, net }) => (
              <li key={o.id}>
                <button type="button" onClick={() => navigate(`/angebote/${o.id}`)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-(--surface-2)">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium tabular">{o.number}</span>
                    <StatusBadge offer={o} shown={shown} today={today} />
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-(--text-muted)">{[(o.customerId && contacts.get(o.customerId)?.name) || "", o.subject].filter(Boolean).join(" · ") || "–"}</span>
                    <span className="shrink-0 font-semibold tabular">{fmtMoney(net)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {/* tablet and up: table */}
          <div className="hidden sm:block">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
                <tr>
                  <th className="w-[150px] px-4 py-2">Nummer</th>
                  <th className="px-3 py-2">Kunde · Betreff</th>
                  <th className="hidden w-[104px] px-3 py-2 xl:table-cell">Datum</th>
                  <th className="hidden w-[104px] px-3 py-2 lg:table-cell">Gültig bis</th>
                  <th className="w-[124px] px-3 py-2">Status</th>
                  <th className="w-[124px] px-4 py-2 text-right">Netto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {visible.map(({ offer: o, shown, net }) => {
                  const project = o.projectId ? projectMap.get(o.projectId) : undefined;
                  const soon = isOfferExpiringSoon(o, today);
                  return (
                    <tr key={o.id} tabIndex={0} onClick={() => navigate(`/angebote/${o.id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/angebote/${o.id}`); } }} className="cursor-pointer hover:bg-(--surface-2) focus-visible:bg-(--surface-2) focus-visible:outline-none">
                      <td className="truncate px-4 py-2.5 font-medium tabular">{o.number}</td>
                      <td className="px-3 py-2.5">
                        <span className="block truncate">{(o.customerId && contacts.get(o.customerId)?.name) || "–"}</span>
                        <span className="block truncate text-xs text-(--text-muted)">{[o.subject, project ? projectLabel(project) : ""].filter(Boolean).join(" · ") || "–"}</span>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 tabular xl:table-cell">{fmtDate(o.date)}</td>
                      <td className={cls("hidden whitespace-nowrap px-3 py-2.5 tabular lg:table-cell", soon && "text-amber-700 dark:text-amber-300")}>{fmtDate(o.validUntil)}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={OFFER_STATUS[shown].tone}>{OFFER_STATUS[shown].label}</Badge>
                        {soon ? <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300">läuft bald ab</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular">{fmtMoney(net)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-(--border) text-(--text-muted)">
                  <td className="px-4 py-2 text-xs" colSpan={2}>{visible.length} Angebot{visible.length === 1 ? "" : "e"}</td>
                  <td className="hidden xl:table-cell" />
                  <td className="hidden lg:table-cell" />
                  <td />
                  <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular text-(--text)">{fmtMoney(visible.reduce((s, r) => s + r.net, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ offer, shown, today }: { offer: Offer; shown: OfferStatus; today: string }) {
  const soon = isOfferExpiringSoon(offer, today);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={OFFER_STATUS[shown].tone}>{OFFER_STATUS[shown].label}</Badge>
      {soon ? <Badge tone="warning">läuft bald ab</Badge> : null}
    </span>
  );
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}
