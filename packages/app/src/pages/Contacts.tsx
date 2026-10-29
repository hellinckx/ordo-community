import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Archive, ArchiveRestore, ArrowLeft, Building2, Globe, Landmark, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, Search, Trash2, UserRound, Users } from "lucide-react";
import { TREATMENT_LABELS, can, ids, invoiceTotals, newId, nowIso, type Contact, type ContactPerson, type Invoice, type Offer, type Project, type Transaction, type VatTreatment } from "@ordo/core";
import { useCategoryMap, useContacts, useList, useProfile, useVault } from "@/state/hooks";
import { requirePlatform, requireStore } from "@/state/session";
import { useIsInstalled, useMe } from "@/modules/registry";
import { nextContactNumberFor } from "@/modules/basis/contactNumber";
import { FileList } from "@/modules/basis/files/FileList";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Menu, Modal, PageHeader, Select, Stat, Switch, Tabs, Textarea } from "@/components/ui";
import { CategoryPicker } from "@/components/pickers";
import { cls, fmtDate, fmtMoney, initials } from "@/lib/format";
import { Avatar, AvatarPicker } from "@/components/AvatarPicker";
import { countryError, emailError, formatIban, ibanError, phoneError, uidError, websiteError, zipError } from "@/lib/validate";
import { toast } from "@/state/toasts";

type KindFilter = "all" | "customer" | "vendor" | "both";

const KIND_LABEL: Record<Contact["kind"], string> = { customer: "Kunde", vendor: "Lieferant", both: "Kunde & Lieferant" };

const PROJECT_STATUS: Record<Project["status"], { label: string; tone: "neutral" | "success" | "warning" | "info" | "brand" }> = {
  planning: { label: "In Planung", tone: "neutral" },
  active: { label: "Läuft", tone: "brand" },
  on_hold: { label: "Pausiert", tone: "warning" },
  completed: { label: "Abgeschlossen", tone: "success" },
  cancelled: { label: "Abgebrochen", tone: "neutral" },
};
const OFFER_STATUS: Record<Offer["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Entwurf", tone: "neutral" },
  sent: { label: "Verschickt", tone: "info" },
  accepted: { label: "Angenommen", tone: "success" },
  declined: { label: "Abgelehnt", tone: "neutral" },
  expired: { label: "Abgelaufen", tone: "warning" },
};
const INVOICE_STATUS: Record<Invoice["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Entwurf", tone: "neutral" },
  sent: { label: "Gesendet", tone: "info" },
  paid: { label: "Bezahlt", tone: "success" },
  overdue: { label: "Überfällig", tone: "danger" },
  cancelled: { label: "Storniert", tone: "neutral" },
};

const PAYMENT_TERM_SUGGESTIONS = [
  "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
  "Zahlbar innerhalb von 30 Tagen netto.",
  "Zahlbar innerhalb von 8 Tagen mit 2 % Skonto oder 30 Tagen netto.",
  "Zahlbar sofort nach Erhalt ohne Abzug.",
];

const isOpenTx = (t: Transaction) => !!t.dueDate && !t.paidDate;
const offerNet = (o: Offer) => {
  const sum = o.lines.filter((l) => !l.optional).reduce((s, l) => s + Math.round(l.quantity * l.unitNetCents), 0);
  return Math.round(sum * (1 - (o.discountPct || 0) / 100));
};
const personName = (p: ContactPerson) => [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "Ohne Namen";
const websiteUrl = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

/** /kontakte and /kontakte/:id */
export default function Contacts() {
  const { id } = useParams();
  return id ? <ContactDetail key={id} id={id} /> : <ContactList />;
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

function ContactList() {
  const contacts = useContacts();
  const txs = useList("transactions");
  const cats = useCategoryMap();
  const summa = useIsInstalled("summa");
  const mailInstalled = useIsInstalled("post");
  const { role } = useMe();
  const canWrite = can(role, "contacts", "write");
  const showMoney = summa && can(role, "summa", "read");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  // "+ Neu → Kontakt" lands here with ?neu=1
  useEffect(() => {
    if (params.get("neu") !== "1") return;
    if (canWrite) setCreating(true);
    const next = new URLSearchParams(params);
    next.delete("neu");
    setParams(next, { replace: true });
  }, [params, setParams, canWrite]);

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>();
    for (const t of txs) {
      if (!t.contactId) continue;
      const s = m.get(t.contactId) ?? { count: 0, total: 0 };
      s.count++;
      s.total += t.grossCents;
      m.set(t.contactId, s);
    }
    return m;
  }, [txs]);

  const archivedCount = contacts.filter((c) => c.active === false).length;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return contacts
      .filter((c) => (status === "archived" ? c.active === false : c.active !== false))
      .filter((c) => kind === "all" || (kind === "both" ? c.kind === "both" : c.kind === kind || c.kind === "both"))
      .filter((c) => {
        if (!s) return true;
        const hay = [c.name, c.number, c.uid, c.city, c.email, c.phone, ...(c.persons ?? []).flatMap((p) => [p.firstName, p.lastName, p.email])].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(s);
      });
  }, [contacts, q, kind, status]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kontakte"
        subtitle={summa ? "Kunden und Lieferanten an einem Ort. Ordo legt sie beim Lesen deiner Rechnungen auch selbst an." : "Deine Kunden und Lieferanten an einem Ort – mit Ansprechpartnern, Projekten und Dateien."}
        actions={canWrite ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Kontakt</Button> : null}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Nummer, Ort, Person …" className="pl-9" />
        </div>
        <Tabs tabs={[{ id: "all", label: "Alle" }, { id: "customer", label: "Kunden" }, { id: "vendor", label: "Lieferanten" }, { id: "both", label: "Kunde & Lieferant" }]} value={kind} onChange={setKind} />
        {archivedCount || status === "archived" ? (
          <Tabs tabs={[{ id: "active", label: "Aktiv" }, { id: "archived", label: `Archiviert (${archivedCount})` }]} value={status} onChange={setStatus} />
        ) : null}
      </div>
      {!filtered.length ? (
        q || kind !== "all" || status === "archived" ? (
          <EmptyState icon={<Search className="h-8 w-8" />} title="Nichts gefunden" body="Kein Kontakt passt zu Suche und Filter." />
        ) : (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="Noch keine Kontakte"
            body={summa ? "Kontakte entstehen von selbst, sobald Ordo deine Rechnungen liest – oder du legst sie hier an." : "Leg deinen ersten Kunden oder Lieferanten an."}
            action={canWrite ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Kontakt anlegen</Button> : undefined}
          />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const s = showMoney ? stats.get(c.id) : undefined;
            const cat = summa && c.defaultCategoryId ? cats.get(c.defaultCategoryId) : undefined;
            const persons = c.persons ?? [];
            return (
              <div key={c.id} className="surface flex items-start gap-3 p-4 transition-shadow hover:shadow-[0_4px_20px_-8px_rgb(0_0_0/0.12)]">
                <Link to={`/kontakte/${c.id}`} className="flex min-w-0 flex-1 items-start gap-3">
                  {c.logoAttachmentId ? <Avatar name={c.name} imageId={c.logoAttachmentId} square /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-sm font-bold text-brand-800 dark:bg-brand-900/40 dark:text-brand-100">{initials(c.name)}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <Badge>{KIND_LABEL[c.kind]}</Badge>
                    </span>
                    <span className="block truncate text-xs text-(--text-muted)">{[c.number, [c.zip, c.city].filter(Boolean).join(" "), c.uid].filter(Boolean).join(" · ") || "–"}</span>
                    {persons.length ? (
                      <span className="mt-1 flex items-center gap-1 truncate text-xs text-(--text-muted)">
                        <UserRound className="h-3 w-3 shrink-0" />
                        {personName(persons[0]!)}
                        {persons.length > 1 ? ` +${persons.length - 1}` : ""}
                      </span>
                    ) : null}
                    {cat ? <span className="mt-1 block text-xs text-(--text-muted)">Standard: {cat.name}</span> : null}
                    {s ? <span className="mt-1 block text-xs"><strong className="tabular font-semibold">{fmtMoney(s.total)}</strong> in {s.count} Buchung{s.count === 1 ? "" : "en"}</span> : null}
                  </span>
                </Link>
                {canWrite ? (
                  <button className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface-2)" onClick={() => setEditing(c)} aria-label={`${c.name} bearbeiten`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <ContactDialog
        open={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        contact={editing ?? undefined}
        kind={kind === "customer" || kind === "vendor" || kind === "both" ? kind : undefined}
        onSaved={(c, isNew) => { if (isNew) navigate(`/kontakte/${c.id}`); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function ContactDetail({ id }: { id: string }) {
  const vault = useVault();
  const profile = useProfile();
  const cats = useCategoryMap();
  const navigate = useNavigate();
  const summa = useIsInstalled("summa");
  const mailInstalled = useIsInstalled("post");
  const projekte = useIsInstalled("projekte");
  const { role } = useMe();
  const canRead = can(role, "contacts", "read");
  const canWrite = can(role, "contacts", "write");
  const canDelete = can(role, "contacts", "admin");
  const showMoney = summa && can(role, "summa", "read");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const contact = vault.contacts.find((c) => c.id === id && !c.deletedAt);

  const related = useMemo(() => {
    const mine = <T extends { profileId: string; deletedAt?: string }>(list: T[]) => list.filter((x) => !x.deletedAt && x.profileId === profile.id);
    const projects = mine(vault.projects).filter((p) => p.customerId === id).sort((a, b) => (b.startDate ?? b.createdAt).localeCompare(a.startDate ?? a.createdAt));
    const offers = mine(vault.offers).filter((o) => o.customerId === id).sort((a, b) => b.date.localeCompare(a.date));
    const invoices = mine(vault.invoices).filter((i) => i.customerId === id).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    const txs = mine(vault.transactions).filter((t) => t.contactId === id).sort((a, b) => (b.paidDate ?? b.date).localeCompare(a.paidDate ?? a.date));
    const sum = (list: Transaction[]) => list.reduce((s, t) => s + t.grossCents, 0);
    const income = txs.filter((t) => t.kind === "income");
    const expense = txs.filter((t) => t.kind === "expense");
    // invoices without a booking yet still count as open
    const openInvoices = invoices.filter((i) => (i.status === "sent" || i.status === "overdue") && !i.transactionId).reduce((s, i) => s + invoiceTotals(i).grossCents - i.paidCents, 0);
    return {
      projects,
      offers,
      invoices,
      txs,
      paidIncome: sum(income.filter((t) => !isOpenTx(t))),
      openIncome: sum(income.filter(isOpenTx)) + openInvoices,
      paidExpense: sum(expense.filter((t) => !isOpenTx(t))),
      openExpense: sum(expense.filter(isOpenTx)),
    };
  }, [vault.projects, vault.offers, vault.invoices, vault.transactions, id, profile.id]);

  if (!canRead || !contact) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState icon={<Users className="h-8 w-8" />} title={canRead ? "Kontakt nicht gefunden" : "Kein Zugriff"} body={canRead ? "Vielleicht wurde er gelöscht oder gehört zu einem anderen Profil." : "Mit deiner Rolle siehst du die Kontakte nicht."} action={<Button variant="outline" onClick={() => navigate("/kontakte")}>Zu den Kontakten</Button>} />
      </div>
    );
  }

  const archived = contact.active === false;
  const isCustomer = contact.kind !== "vendor";
  const isVendor = contact.kind !== "customer";
  const cat = contact.defaultCategoryId ? cats.get(contact.defaultCategoryId) : undefined;
  const setArchived = (a: boolean) => {
    requireStore().update("contacts", contact.id, { active: a ? false : true }, a ? "contact.archive" : "contact.restore");
    toast.success(a ? "Archiviert" : "Wieder aktiv", a ? "Der Kontakt taucht in Auswahllisten nicht mehr auf." : undefined);
  };

  const moneyStats: ReactNode[] = [];
  if (showMoney) {
    if (isCustomer || related.paidIncome || related.openIncome) {
      moneyStats.push(<Stat key="pi" label="Umsatz bezahlt" value={fmtMoney(related.paidIncome)} sub="brutto, alle Jahre" />);
      moneyStats.push(<Stat key="oi" label="Offen" value={fmtMoney(related.openIncome)} sub={related.openIncome ? "noch nicht bezahlt" : "nichts offen"} tone={related.openIncome ? "neutral" : undefined} />);
    }
    if (isVendor || related.paidExpense || related.openExpense) {
      moneyStats.push(<Stat key="pe" label="Ausgaben bezahlt" value={fmtMoney(related.paidExpense)} sub="brutto, alle Jahre" />);
      if (related.openExpense || !isCustomer) moneyStats.push(<Stat key="oe" label="Noch zu bezahlen" value={fmtMoney(related.openExpense)} />);
    }
  }

  const menuItems = [
    ...(canWrite ? [archived ? { label: "Wieder aktivieren", icon: <ArchiveRestore className="h-4 w-4" />, onClick: () => setArchived(false) } : { label: "Archivieren", icon: <Archive className="h-4 w-4" />, onClick: () => setArchived(true) }] : []),
    ...(canDelete ? [{ label: "Löschen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
  ];

  return (
    <div className="space-y-5">
      <BackLink />
      <div className="flex flex-wrap items-start gap-4">
        {contact.logoAttachmentId ? <Avatar name={contact.name} imageId={contact.logoAttachmentId} size="lg" square className="rounded-2xl" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-lg font-bold text-brand-800 dark:bg-brand-900/40 dark:text-brand-100">{initials(contact.name)}</span>}
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words">{contact.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-(--text-muted)">
            {contact.number ? <Badge tone="brand">{contact.number}</Badge> : null}
            <Badge>{KIND_LABEL[contact.kind]}</Badge>
            {archived ? <Badge tone="warning">archiviert</Badge> : null}
            {contact.city ? <span>{contact.city}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canWrite ? <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Bearbeiten</Button> : null}
          {menuItems.length ? <Menu trigger={<Button variant="ghost" size="icon" aria-label="Weitere Aktionen"><MoreHorizontal className="h-4 w-4" /></Button>} items={menuItems} /> : null}
        </div>
      </div>

      {moneyStats.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{moneyStats}</div> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <Card title="Stammdaten" action={canWrite ? <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Ändern</Button> : null}>
            <MasterData contact={contact} categoryName={summa ? cat?.name : undefined} showTax={summa} onEdit={canWrite ? () => setEditing(true) : undefined} />
          </Card>
          <PersonsCard contact={contact} canWrite={canWrite} />
          <NotesCard contact={contact} canWrite={canWrite} />
        </div>
        <div className="space-y-5 lg:col-span-2">
          {projekte || related.projects.length ? (
            <RelatedCard title="Projekte" count={related.projects.length} empty="Noch keine Projekte für diesen Kontakt.">
              {related.projects.map((p) => (
                <RelatedRow key={p.id} to={`/projekte/${p.id}`} title={[p.number, p.name].filter(Boolean).join(" · ")} sub={[p.startDate ? fmtDate(p.startDate) : "", p.endDate ? `bis ${fmtDate(p.endDate)}` : ""].filter(Boolean).join(" ")} right={<Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>} />
              ))}
            </RelatedCard>
          ) : null}
          {projekte || related.offers.length ? (
            <RelatedCard title="Angebote" count={related.offers.length} empty="Noch keine Angebote.">
              {related.offers.map((o) => (
                <RelatedRow key={o.id} to={`/angebote/${o.id}`} title={[o.number, o.subject].filter(Boolean).join(" · ")} sub={fmtDate(o.date)} right={<><span className="tabular text-sm font-medium">{fmtMoney(offerNet(o))}</span><Badge tone={OFFER_STATUS[o.status].tone}>{OFFER_STATUS[o.status].label}</Badge></>} />
              ))}
            </RelatedCard>
          ) : null}
          {showMoney && (isCustomer || related.invoices.length) && profile.mode === "business" ? (
            <RelatedCard title="Rechnungen" count={related.invoices.length} empty="Noch keine Rechnungen an diesen Kontakt.">
              {related.invoices.map((i) => (
                <RelatedRow key={i.id} to={`/rechnungen/${i.id}`} title={i.number || "Entwurf"} sub={`${fmtDate(i.issueDate)}${i.status === "sent" || i.status === "overdue" ? ` · fällig ${fmtDate(i.dueDate)}` : ""}`} right={<><span className="tabular text-sm font-medium">{fmtMoney(invoiceTotals(i).grossCents)}</span><Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge></>} />
              ))}
            </RelatedCard>
          ) : null}
          {showMoney ? (
            <RelatedCard title="Einnahmen & Ausgaben" count={related.txs.length} empty="Noch nichts gebucht." action={related.txs.length > 8 ? <Link to="/buchungen" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Alle Buchungen</Link> : undefined}>
              {related.txs.slice(0, 8).map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.description || t.invoiceNumber || (t.kind === "income" ? "Einnahme" : "Ausgabe")}</div>
                    <div className="truncate text-xs text-(--text-muted)">{fmtDate(t.paidDate ?? t.date)}{isOpenTx(t) ? ` · offen, fällig ${fmtDate(t.dueDate)}` : ""}</div>
                  </div>
                  <span className={cls("tabular font-semibold", t.kind === "income" && "text-emerald-700 dark:text-emerald-400")}>{t.kind === "income" ? "+" : t.kind === "expense" ? "−" : ""}{fmtMoney(t.grossCents)}</span>
                </li>
              ))}
            </RelatedCard>
          ) : null}
          <FileList link={{ type: "contact", id: contact.id }} />
        </div>
      </div>

      <ContactDialog open={editing} onClose={() => setEditing(false)} contact={contact} onDeleted={() => navigate("/kontakte")} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Kontakt löschen?"
        body="Buchungen, Rechnungen und Projekte bleiben erhalten, verlieren aber die Verknüpfung. Willst du ihn nur aus den Listen haben, archiviere ihn lieber."
        confirmLabel="Löschen"
        onConfirm={() => {
          requireStore().softDelete("contacts", contact.id);
          navigate("/kontakte");
        }}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/kontakte" className="inline-flex items-center gap-1 text-sm font-medium text-(--text-muted) hover:text-(--text)">
      <ArrowLeft className="h-4 w-4" /> Kontakte
    </Link>
  );
}

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="mt-0.5 text-(--text-muted)">{icon}</span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </li>
  );
}

function MasterData({ contact: c, categoryName, showTax, onEdit }: { contact: Contact; categoryName?: string; showTax: boolean; onEdit?: () => void }) {
  const address = [c.street, [c.zip, c.city].filter(Boolean).join(" "), c.country && c.country !== "AT" ? c.country : ""].filter(Boolean);
  const rows: ReactNode[] = [];
  if (address.length) rows.push(<InfoRow key="adr" icon={<MapPin className="h-4 w-4" />}>{address.map((l, i) => <div key={i}>{l}</div>)}</InfoRow>);
  if (c.email) rows.push(<InfoRow key="mail" icon={<Mail className="h-4 w-4" />}><a href={`mailto:${c.email}`} className="text-brand-700 hover:underline dark:text-brand-400">{c.email}</a></InfoRow>);
  if (c.phone) rows.push(<InfoRow key="tel" icon={<Phone className="h-4 w-4" />}><a href={`tel:${c.phone.replace(/\s/g, "")}`} className="hover:underline">{c.phone}</a></InfoRow>);
  if (c.website) rows.push(<InfoRow key="web" icon={<Globe className="h-4 w-4" />}><button type="button" onClick={() => void requirePlatform().openUrl(websiteUrl(c.website!))} className="text-left text-brand-700 hover:underline dark:text-brand-400">{c.website.replace(/^https?:\/\//i, "")}</button></InfoRow>);
  if (c.uid) rows.push(<InfoRow key="uid" icon={<Building2 className="h-4 w-4" />}>UID {c.uid}</InfoRow>);
  if (c.iban) rows.push(<InfoRow key="iban" icon={<Landmark className="h-4 w-4" />}><span className="tabular">{c.iban}</span></InfoRow>);
  const terms: string[] = [];
  if (c.paymentDueDays !== undefined && c.paymentDueDays !== null) terms.push(c.paymentDueDays === 0 ? "Zahlbar sofort" : `Zahlungsziel ${c.paymentDueDays} Tage`);
  if (c.paymentTerms) terms.push(c.paymentTerms);
  return (
    <div className="space-y-4">
      {rows.length ? <ul className="space-y-3">{rows}</ul> : <p className="text-sm text-(--text-muted)">Noch keine Adresse oder Kontaktdaten.{onEdit ? <button type="button" onClick={onEdit} className="ml-1 font-medium text-brand-700 hover:underline dark:text-brand-400">Ergänzen</button> : null}</p>}
      {terms.length || categoryName || (showTax && c.defaultVatTreatment) ? (
        <dl className="space-y-2 border-t border-(--border) pt-3 text-sm">
          {terms.length ? <div><dt className="text-xs text-(--text-muted)">Zahlung</dt><dd>{terms.join(" · ")}</dd></div> : null}
          {categoryName ? <div><dt className="text-xs text-(--text-muted)">Standardkategorie</dt><dd>{categoryName}</dd></div> : null}
          {showTax && c.defaultVatTreatment ? <div><dt className="text-xs text-(--text-muted)">Umsatzsteuer</dt><dd>{TREATMENT_LABELS[c.defaultVatTreatment]}</dd></div> : null}
        </dl>
      ) : null}
    </div>
  );
}

function RelatedCard({ title, count, empty, action, children }: { title: string; count: number; empty: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card title={<span>{title}{count ? <span className="ml-1.5 font-normal text-(--text-muted)">{count}</span> : null}</span>} action={action} padded={false}>
      {count ? <ul className="divide-y divide-(--border)">{children}</ul> : <p className="px-5 py-5 text-sm text-(--text-muted)">{empty}</p>}
    </Card>
  );
}

function RelatedRow({ to, title, sub, right }: { to: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-5 py-2.5 hover:bg-(--surface-2)">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {sub ? <div className="truncate text-xs text-(--text-muted)">{sub}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Ansprechpartner                                                     */
/* ------------------------------------------------------------------ */

function PersonsCard({ contact, canWrite }: { contact: Contact; canWrite: boolean }) {
  const persons = contact.persons ?? [];
  const [editing, setEditing] = useState<ContactPerson | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ContactPerson | null>(null);
  const write = (next: ContactPerson[]) => requireStore().update("contacts", contact.id, { persons: next }, "contact.persons");
  return (
    <Card title={<span>Ansprechpartner{persons.length ? <span className="ml-1.5 font-normal text-(--text-muted)">{persons.length}</span> : null}</span>} action={canWrite ? <Button variant="ghost" size="sm" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> Person</Button> : null} padded={false}>
      {persons.length ? (
        <ul className="divide-y divide-(--border)">
          {persons.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--surface-2) text-xs font-semibold text-(--text-muted)">{initials(personName(p))}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{personName(p)}</div>
                {p.role ? <div className="text-xs text-(--text-muted)">{p.role}</div> : null}
                <div className="mt-1 flex flex-col gap-0.5 text-xs">
                  {p.email ? <a href={`mailto:${p.email}`} className="truncate text-brand-700 hover:underline dark:text-brand-400">{p.email}</a> : null}
                  {p.phone ? <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="hover:underline">{p.phone}</a> : null}
                  {p.notes ? <span className="text-(--text-muted)">{p.notes}</span> : null}
                </div>
              </div>
              {canWrite ? (
                <Menu
                  trigger={<button type="button" className="rounded-md p-1 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Aktionen"><MoreHorizontal className="h-4 w-4" /></button>}
                  items={[
                    { label: "Bearbeiten", icon: <Pencil className="h-4 w-4" />, onClick: () => setEditing(p) },
                    { label: "Entfernen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setRemoving(p) },
                  ]}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-5 text-sm text-(--text-muted)">
          Noch niemand eingetragen.
          {canWrite ? <button type="button" onClick={() => setCreating(true)} className="ml-1 font-medium text-brand-700 hover:underline dark:text-brand-400">Person hinzufügen</button> : null}
        </p>
      )}
      <PersonDialog
        open={creating || !!editing}
        person={editing ?? undefined}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSave={(p) => write(editing ? persons.map((x) => (x.id === p.id ? p : x)) : [...persons, p])}
      />
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger title="Ansprechpartner entfernen?" body={removing ? `${personName(removing)} wird aus diesem Kontakt entfernt.` : ""} confirmLabel="Entfernen" onConfirm={() => { if (removing) write(persons.filter((x) => x.id !== removing.id)); }} />
    </Card>
  );
}

function PersonDialog({ open, person, onClose, onSave }: { open: boolean; person?: ContactPerson; onClose: () => void; onSave: (p: ContactPerson) => void }) {
  const blank = (): ContactPerson => ({ id: newId("cps"), firstName: "", lastName: "", email: "", phone: "", role: "", notes: "" });
  const [v, setV] = useState<ContactPerson>(person ?? blank());
  useEffect(() => {
    if (open) setV(person ?? blank());
  }, [open, person]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<ContactPerson>) => setV((x) => ({ ...x, ...p }));
  const save = () => {
    if (!v.firstName.trim() && !v.lastName.trim()) {
      toast.warning("Gib zumindest einen Namen an.");
      return;
    }
    onSave({ ...v, firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email.trim(), phone: v.phone.trim(), role: v.role.trim() });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={person ? "Ansprechpartner bearbeiten" : "Neuer Ansprechpartner"} size="md" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save}>Speichern</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vorname"><Input autoFocus value={v.firstName} onChange={(e) => set({ firstName: e.target.value })} /></Field>
        <Field label="Nachname"><Input value={v.lastName} onChange={(e) => set({ lastName: e.target.value })} /></Field>
        <Field label="Funktion" hint="z. B. Geschäftsführung, Einkauf, Buchhaltung" className="sm:col-span-2"><Input value={v.role} onChange={(e) => set({ role: e.target.value })} /></Field>
        <Field label="E-Mail"><Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Telefon"><Input value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="Notizen" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function NotesCard({ contact, canWrite }: { contact: Contact; canWrite: boolean }) {
  const [notes, setNotes] = useState(contact.notes);
  useEffect(() => setNotes(contact.notes), [contact.id, contact.notes]);
  if (!canWrite && !contact.notes) return null;
  return (
    <Card title="Notizen">
      {canWrite ? (
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== contact.notes && requireStore().update("contacts", contact.id, { notes }, "contact.notes")} placeholder="Was du dir über diesen Kontakt merken willst …" className="min-h-28" />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit dialog                                                */
/* ------------------------------------------------------------------ */

type ContactSection = "allgemein" | "adresse" | "zahlung" | "buchhaltung" | "notizen";
const CONTACT_SECTIONS: { id: ContactSection; label: string }[] = [
  { id: "allgemein", label: "Allgemein" },
  { id: "adresse", label: "Adresse & Kontakt" },
  { id: "zahlung", label: "Zahlung" },
  { id: "buchhaltung", label: "Buchhaltung" },
  { id: "notizen", label: "Notizen" },
];

export function ContactDialog({ open, onClose, contact, kind, onSaved, onDeleted }: { open: boolean; onClose: () => void; contact?: Contact; kind?: Contact["kind"]; onSaved?: (c: Contact, isNew: boolean) => void; onDeleted?: () => void }) {
  const profile = useProfile();
  const vault = useVault();
  const contacts = useList("contacts");
  const summa = useIsInstalled("summa");
  const mailInstalled = useIsInstalled("post");
  const { role } = useMe();
  const canDelete = can(role, "contacts", "admin");
  const blank = (): Contact => ({ id: ids.contact(), profileId: profile.id, name: "", kind: kind ?? "vendor", uid: "", email: "", phone: "", street: "", zip: "", city: "", country: "AT", iban: "", notes: "", aliases: [], createdAt: nowIso(), updatedAt: nowIso() });
  const [v, setV] = useState<Contact>(contact ?? blank());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [section, setSection] = useState<ContactSection>("allgemein");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setV(contact ?? blank());
      setSection("allgemein");
      setTried(false);
    }
  }, [open, contact]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Contact>) => setV((x) => ({ ...x, ...p }));
  const errors = {
    name: !v.name.trim() ? "Bitte einen Namen eintragen." : undefined,
    uid: uidError(v.uid),
    website: websiteError(v.website ?? ""),
    zip: zipError(v.zip, v.country),
    country: countryError(v.country),
    email: emailError(v.email),
    phone: phoneError(v.phone),
    iban: ibanError(v.iban),
  };
  const sectionOf: Record<keyof typeof errors, ContactSection> = { name: "allgemein", uid: "allgemein", website: "allgemein", zip: "adresse", country: "adresse", email: "adresse", phone: "adresse", iban: "zahlung" };
  const bad = (sec: ContactSection) => tried && (Object.keys(errors) as (keyof typeof errors)[]).some((k) => errors[k] && sectionOf[k] === sec);
  const show = (k: keyof typeof errors) => (tried || k !== "name" ? errors[k] : undefined);
  const save = () => {
    setTried(true);
    const problem = (Object.keys(errors) as (keyof typeof errors)[]).find((k) => errors[k]);
    if (problem) {
      setSection(sectionOf[problem]);
      toast.warning("Bitte prüfen", errors[problem]);
      return;
    }
    const store = requireStore();
    const number = v.number?.trim() || nextContactNumberFor(store.vault, v.profileId);
    const clash = contacts.find((c) => c.id !== v.id && c.number?.toLowerCase() === number.toLowerCase());
    if (clash) {
      toast.warning(`Die Nummer ${number} hat schon „${clash.name}“.`);
      return;
    }
    const next: Contact = { ...v, name: v.name.trim(), number, uid: v.uid.replace(/\s+/g, "").toUpperCase(), iban: v.iban.replace(/\s+/g, "").toUpperCase(), email: v.email.trim(), website: v.website?.trim() || undefined, paymentTerms: v.paymentTerms?.trim() || undefined, updatedAt: nowIso() };
    if (contact) store.update("contacts", contact.id, next);
    else store.insert("contacts", next, "contact.create");
    onSaved?.(next, !contact);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={contact ? "Kontakt bearbeiten" : "Neuer Kontakt"} size="lg" footer={<>{contact && canDelete ? <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)} aria-label="Kontakt löschen"><Trash2 className="h-4 w-4" /></Button> : null}<Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save}>Speichern</Button></>}>
      <div className="space-y-4">
        <Tabs
          value={section}
          onChange={setSection}
          tabs={CONTACT_SECTIONS.filter((x) => x.id !== "buchhaltung" || summa).map((x) => ({ id: x.id, label: <span className="inline-flex items-center gap-1.5">{x.label}{bad(x.id) ? <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-label="enthält Fehler" /> : null}</span> }))}
        />
        {section === "allgemein" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-end gap-3 sm:col-span-2">
              <AvatarPicker name={v.name} imageId={v.logoAttachmentId} onChange={(id) => set({ logoAttachmentId: id })} square label="Logo" />
            </div>
            <Field label="Name / Firma" required className="sm:col-span-2" error={show("name")}><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. Muster GmbH" /></Field>
            <Field label="Art"><Select value={v.kind} onChange={(e) => set({ kind: e.target.value as Contact["kind"] })}><option value="vendor">Lieferant</option><option value="customer">Kunde</option><option value="both">Kunde und Lieferant</option></Select></Field>
            <Field label="Nummer" hint={v.number ? undefined : "Wird beim Speichern vergeben."}><Input value={v.number ?? ""} onChange={(e) => set({ number: e.target.value })} placeholder={nextContactNumberFor(vault, v.profileId)} /></Field>
            <Field label="UID-Nummer" error={show("uid")}><Input value={v.uid} onChange={(e) => set({ uid: e.target.value.toUpperCase() })} placeholder="z. B. ATU12345678" /></Field>
            <Field label="Website" error={show("website")}><Input value={v.website ?? ""} onChange={(e) => set({ website: e.target.value })} placeholder="z. B. muster.at" /></Field>
            {contact ? (
              <div className="sm:col-span-2">
                <Switch checked={v.active !== false} onChange={(a) => set({ active: a })} label="Aktiv" hint="Archivierte Kontakte bleiben mit allen Rechnungen erhalten, tauchen aber in Auswahllisten nicht mehr auf." />
              </div>
            ) : null}
          </div>
        ) : null}
        {section === "adresse" ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
            <Field label="Straße" className="sm:col-span-3"><Input value={v.street} onChange={(e) => set({ street: e.target.value })} placeholder="z. B. Hauptplatz 1" /></Field>
            <Field label="PLZ" error={show("zip")}><Input inputMode="numeric" value={v.zip} onChange={(e) => set({ zip: e.target.value })} placeholder="z. B. 1010" /></Field>
            <Field label="Ort"><Input value={v.city} onChange={(e) => set({ city: e.target.value })} placeholder="z. B. Wien" /></Field>
            <Field label="Land" hint="AT, DE, CH …" error={show("country")}><Input value={v.country} maxLength={2} onChange={(e) => set({ country: e.target.value.toUpperCase() })} /></Field>
            <Field label="E-Mail" className="sm:col-span-2" error={show("email")}><Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="z. B. office@muster.at" /></Field>
            <Field label="Telefon" error={show("phone")}><Input type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+43 …" /></Field>
            {mailInstalled ? (
              <div className="sm:col-span-3">
                <Switch checked={!!v.newsletter} onChange={(on) => set({ newsletter: on, newsletterConsentAt: on ? nowIso() : undefined })} label="Bekommt den Newsletter" hint={v.newsletter && v.newsletterConsentAt ? `Zugestimmt am ${fmtDate(v.newsletterConsentAt.slice(0, 10))}. Nur anhaken, wenn die Person zugestimmt hat.` : "Nur anhaken, wenn die Person zugestimmt hat (TKG § 174)."} />
              </div>
            ) : null}
          </div>
        ) : null}
        {section === "zahlung" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="IBAN" className="sm:col-span-2" error={show("iban")} hint={!errors.iban && v.iban ? "Prüfziffer stimmt." : undefined}><Input value={v.iban} onChange={(e) => set({ iban: e.target.value.toUpperCase() })} onBlur={() => !errors.iban && set({ iban: formatIban(v.iban) })} placeholder="z. B. AT61 1904 3002 3457 3201" /></Field>
            <Field label="Zahlungsziel (Tage)" hint="Für Angebote und Rechnungen an diesen Kunden.">
              <Input type="number" inputMode="numeric" min={0} max={365} value={v.paymentDueDays ?? ""} onChange={(e) => set({ paymentDueDays: e.target.value === "" ? undefined : Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) })} placeholder="14" />
            </Field>
            <Field label="Zahlungsbedingungen">
              <Input list="ordo-payment-terms" value={v.paymentTerms ?? ""} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="Vorschlag wählen oder selbst schreiben" />
              <datalist id="ordo-payment-terms">{PAYMENT_TERM_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
          </div>
        ) : null}
        {section === "buchhaltung" && summa ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Standardkategorie" hint="Neue Rechnungen von diesem Kontakt landen automatisch hier." className="sm:col-span-2"><CategoryPicker kind={v.kind === "customer" ? "income" : "expense"} value={v.defaultCategoryId} onChange={(id) => set({ defaultCategoryId: id })} /></Field>
            <Field label="Umsatzsteuer (Standard)" hint="Leer lassen, dann erkennt Ordo es aus der Rechnung.">
              <Select value={v.defaultVatTreatment ?? ""} onChange={(e) => set({ defaultVatTreatment: (e.target.value || undefined) as VatTreatment | undefined })}>
                <option value="">Automatisch</option>
                {(Object.keys(TREATMENT_LABELS) as VatTreatment[]).map((t) => <option key={t} value={t}>{TREATMENT_LABELS[t]}</option>)}
              </Select>
            </Field>
            <Field label="Aliasnamen (kommagetrennt)" hint="Andere Schreibweisen auf Rechnungen, z. B. „billa“, „billa plus“"><Input value={v.aliases.join(", ")} onChange={(e) => set({ aliases: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) })} /></Field>
          </div>
        ) : null}
        {section === "notizen" ? <Field label="Notizen"><Textarea rows={6} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field> : null}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Kontakt löschen?"
        body="Buchungen bleiben erhalten, verlieren aber die Verknüpfung."
        confirmLabel="Löschen"
        onConfirm={() => {
          requireStore().softDelete("contacts", v.id);
          onClose();
          onDeleted?.();
        }}
      />
    </Modal>
  );
}

export { Building2, Mail };
