import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { BellRing, Mail, Megaphone, Send } from "lucide-react";
import { invoiceTotals, todayIso, type Invoice } from "@ordo/core";
import { useContacts, useList, useProfile, useSettings } from "@/state/hooks";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, PageHeader, Stat, Textarea } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";
import { canMailInvoices, canSendNewsletter, emailReady, newsletterRecipients, sendNewsletter } from "@/services/email/send";
import { useMe } from "@/modules/registry";
import { InvoiceMailDialog } from "./InvoiceMailDialog";

const isOverdue = (i: Invoice, today: string) => i.kind === "invoice" && (i.status === "overdue" || (i.status === "sent" && i.dueDate < today));

/** E-Mail: reminders for overdue invoices, the newsletter, and what went out lately. */
export default function PostPage() {
  const settings = useSettings().email;
  const profile = useProfile();
  const invoices = useList("invoices");
  const contacts = useContacts();
  const navigate = useNavigate();
  const { role } = useMe();
  const newsletterAllowed = canSendNewsletter(role);
  const ready = emailReady(settings);
  const today = todayIso();
  const [mail, setMail] = useState<{ invoice: Invoice; reminder: boolean } | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);

  const overdue = useMemo(() => invoices.filter((i) => isOverdue(i, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [invoices, today]);
  const sent = useMemo(() => invoices.filter((i) => i.emailedAt || i.remindedAt).sort((a, b) => (b.remindedAt ?? b.emailedAt ?? "").localeCompare(a.remindedAt ?? a.emailedAt ?? "")).slice(0, 20), [invoices]);
  const recipients = useMemo(() => newsletterRecipients(contacts), [contacts]);
  const withEmail = contacts.filter((c) => !c.deletedAt && c.email.trim()).length;

  if (!canMailInvoices(role)) return <EmptyState icon={<Mail className="h-10 w-10" />} title="Kein Zugriff" body="E-Mails verschicken Personen, die in der Buchhaltung schreiben dürfen." />;

  if (!ready.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="E-Mail" subtitle="Rechnungen, Zahlungserinnerungen und Newsletter direkt aus Ordo – über dein eigenes Brevo-Konto." />
        <EmptyState icon={<Mail className="h-10 w-10" />} title="Noch kein E-Mail-Versand verbunden" body="Leg ein kostenloses Brevo-Konto an (300 E-Mails am Tag), bestätige deine Absender-Adresse und trag den API-Schlüssel ein. Dauert etwa fünf Minuten." action={newsletterAllowed ? <Button onClick={() => navigate("/einstellungen/email")}>Brevo verbinden</Button> : undefined} />
      </div>
    );
  }

  const sendIt = async () => {
    try {
      const n = await sendNewsletter(profile.id, subject.trim(), text);
      toast.success("Newsletter verschickt", `an ${n} Empfänger`);
      setSubject("");
      setText("");
    } catch (e) {
      toast.error("Newsletter nicht verschickt", e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="E-Mail" subtitle={`Versand über Brevo von ${settings.senderEmail}.`} actions={newsletterAllowed ? <Button variant="outline" onClick={() => navigate("/einstellungen/email")}>Einstellungen</Button> : undefined} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Überfällig" value={overdue.length} sub={overdue.length ? `${fmtMoney(overdue.reduce((s, i) => s + invoiceTotals(i).grossCents - i.paidCents, 0))} offen` : "nichts offen"} tone={overdue.length ? "down" : "up"} />
        <Stat label="Per Mail verschickt" value={invoices.filter((i) => i.emailedAt).length} sub="Rechnungen" />
        <Stat label="Newsletter" value={recipients.length} sub={`von ${withEmail} Kontakten mit E-Mail`} />
      </div>

      <Card title="Überfällige Rechnungen" action={<BellRing className="h-4 w-4 text-(--text-muted)" />}>
        {!overdue.length ? <p className="text-sm text-(--text-muted)">Alle Rechnungen sind bezahlt oder noch nicht fällig.</p> : (
          <ul className="divide-y divide-(--border) text-sm">
            {overdue.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{i.number}</span> · {i.customerSnapshot.name}</span>
                <span className="text-xs text-(--text-muted)">fällig {fmtDate(i.dueDate)}{i.remindedAt ? ` · erinnert ${fmtDate(i.remindedAt.slice(0, 10))}` : ""}</span>
                <span className="tabular font-medium">{fmtMoney(invoiceTotals(i).grossCents - i.paidCents)}</span>
                <Button size="sm" variant="outline" onClick={() => setMail({ invoice: i, reminder: true })}>Erinnern</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {newsletterAllowed ? (
      <Card title="Newsletter" action={<Megaphone className="h-4 w-4 text-(--text-muted)" />}>
        <div className="space-y-3">
          <p className="text-sm text-(--text-muted)">Geht nur an Kontakte, die zugestimmt haben (beim Kontakt unter „Adresse“ anhaken) – so verlangt es das Gesetz (TKG § 174). Brevo hängt einen Abmelde-Link an.</p>
          <Field label="Betreff"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="z. B. Neu im Herbst" /></Field>
          <Field label="Text"><Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Liebe Kundinnen und Kunden,\n\n…"} /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-(--text-muted)">{recipients.length ? `${recipients.length} Empfänger` : "Noch niemand hat zugestimmt."}</span>
            <Button disabled={!recipients.length || !subject.trim() || !text.trim()} onClick={() => setConfirm(true)}><Send className="h-4 w-4" /> Newsletter senden</Button>
          </div>
        </div>
      </Card>
      ) : null}

      <Card title="Zuletzt verschickt">
        {!sent.length ? <p className="text-sm text-(--text-muted)">Noch nichts. Fertige Rechnungen verschickst du unter „Ausgehende Rechnungen“ mit „Per E-Mail“.</p> : (
          <ul className="divide-y divide-(--border) text-sm">
            {sent.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{i.number}</span> · {i.customerSnapshot.name}</span>
                {i.remindedAt ? <Badge tone="warning">Erinnerung {fmtDateTime(i.remindedAt)}</Badge> : null}
                {i.emailedAt ? <span className="text-xs text-(--text-muted)">an {i.emailedTo} · {fmtDateTime(i.emailedAt)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <InvoiceMailDialog invoice={mail?.invoice ?? null} reminder={mail?.reminder} onClose={() => setMail(null)} />
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={`Newsletter an ${recipients.length} Empfänger senden?`} body={`„${subject.trim()}“ geht sofort raus und lässt sich nicht zurückholen.`} confirmLabel="Jetzt senden" onConfirm={sendIt} />
    </div>
  );
}
