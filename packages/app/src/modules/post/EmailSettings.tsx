import { useState } from "react";
import { CheckCircle2, ExternalLink, Inbox, Mail, XCircle } from "lucide-react";
import { can, type EmailSettings as EmailSettingsT } from "@ordo/core";
import { useSettings, useSettingsMutator } from "@/state/hooks";
import { useMe } from "@/modules/registry";
import { Button, Card, EmptyState, Field, Input, Select, Switch, Textarea } from "@/components/ui";
import { openExternal } from "@/components/LegalLinks";
import { BREVO_LINKS, brevoAccount, brevoSenders } from "@/services/email/brevo";

/** Einstellungen → E-Mail: the person's own Brevo account, sender and the texts for invoices and reminders. */
export function EmailSettingsTab() {
  const settings = useSettings();
  const mutate = useSettingsMutator();
  const { role } = useMe();
  const editable = can(role, "settings", "write");
  const e = settings.email;
  const set = (patch: Partial<EmailSettingsT>) => mutate((s) => ({ ...s, email: { ...s.email, ...patch } }));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [senders, setSenders] = useState<{ name: string; email: string; active: boolean }[] | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const account = await brevoAccount(e.brevoApiKey);
      const list = await brevoSenders(e.brevoApiKey);
      setSenders(list);
      const active = list.filter((x) => x.active);
      if (active.length && !active.some((x) => x.email === e.senderEmail)) set({ senderEmail: active[0]!.email, senderName: e.senderName || active[0]!.name });
      const credits = account.plan?.find((p) => p.credits != null)?.credits;
      setResult({ ok: true, text: `Verbunden mit ${account.email}${credits != null ? ` · noch ${credits} E-Mails im Kontingent` : ""}${active.length ? "" : " · Noch kein bestätigter Absender – in Brevo unter „Absender“ anlegen."}` });
      if (e.provider !== "brevo") set({ provider: "brevo" });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  // the API key is a secret: only people who may change the settings see this page at all
  if (!editable) return <EmptyState icon={<Mail className="h-8 w-8" />} title="Nur für Inhaber und Admins" body="Den E-Mail-Versand richten Personen mit Admin-Rechten ein." />;

  const link = (href: string, label: string) => (
    <button type="button" onClick={() => openExternal(href)} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-400">
      {label} <ExternalLink className="h-3.5 w-3.5" />
    </button>
  );
  const active = (senders ?? []).filter((x) => x.active);

  return (
    <div className="max-w-3xl space-y-4">
      <Card title="Brevo verbinden">
        <fieldset disabled={!editable} className="min-w-0 space-y-4">
          <p className="text-sm text-(--text-muted)">Ordo verschickt Rechnungen, Zahlungserinnerungen und Newsletter über dein eigenes Brevo-Konto. Der Gratis-Tarif reicht für 300 E-Mails am Tag. Die Mails gehen direkt von diesem Gerät zu Brevo – wir sehen davon nichts.</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>Kostenloses Konto anlegen: {link(BREVO_LINKS.signup, "brevo.com")}</li>
            <li>Deine Absender-Adresse bestätigen (z. B. office@deine-firma.at): {link(BREVO_LINKS.senders, "Absender")}</li>
            <li>Einen API-Schlüssel erstellen und hier einfügen: {link(BREVO_LINKS.apiKeys, "API-Schlüssel")}</li>
          </ol>
          <Field label="API-Schlüssel von Brevo" hint="Wird verschlüsselt in deinem Tresor gespeichert.">
            <Input type="password" autoComplete="off" value={e.brevoApiKey} onChange={(x) => set({ brevoApiKey: x.target.value.trim(), provider: x.target.value.trim() ? "brevo" : "none" })} placeholder="xkeysib-…" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" loading={testing} disabled={!e.brevoApiKey} onClick={() => void test()}>Verbindung prüfen</Button>
            {result ? (
              <span className={result.ok ? "inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400" : "inline-flex items-center gap-1.5 text-sm text-red-600"}>
                {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                {result.text}
              </span>
            ) : null}
          </div>
        </fieldset>
      </Card>

      <Card title="Absender">
        <fieldset disabled={!editable} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field label="Name" hint="So steht es beim Empfänger im Posteingang.">
            <Input value={e.senderName} onChange={(x) => set({ senderName: x.target.value })} placeholder="z. B. Muster GmbH" />
          </Field>
          <Field label="Absender-Adresse" hint="Muss in Brevo bestätigt sein.">
            {active.length ? (
              <Select value={e.senderEmail} onChange={(x) => set({ senderEmail: x.target.value })}>
                {active.map((x) => <option key={x.email} value={x.email}>{x.email}</option>)}
              </Select>
            ) : (
              <Input type="email" value={e.senderEmail} onChange={(x) => set({ senderEmail: x.target.value.trim() })} placeholder="z. B. office@muster.at" />
            )}
          </Field>
          <Field label="Antworten an" hint="Leer = an die Absender-Adresse.">
            <Input type="email" value={e.replyTo} onChange={(x) => set({ replyTo: x.target.value.trim() })} />
          </Field>
          <div className="flex items-end pb-1">
            <Switch checked={e.bccSelf} onChange={(v) => set({ bccSelf: v })} label="Kopie an mich" hint="Jede Rechnungs-Mail auch an die Absender-Adresse." />
          </div>
        </fieldset>
      </Card>

      <Card title="Texte">
        <fieldset disabled={!editable} className="min-w-0 space-y-4">
          <p className="text-xs text-(--text-muted)">Platzhalter: {"{nummer}"} {"{kunde}"} {"{betrag}"} {"{faellig}"} {"{firma}"}. Vor dem Senden kannst du jeden Text noch ändern.</p>
          <Field label="Betreff Rechnung"><Input value={e.invoiceSubject} onChange={(x) => set({ invoiceSubject: x.target.value })} /></Field>
          <Field label="Text Rechnung"><Textarea rows={6} value={e.invoiceText} onChange={(x) => set({ invoiceText: x.target.value })} /></Field>
          <Field label="Betreff Zahlungserinnerung"><Input value={e.reminderSubject} onChange={(x) => set({ reminderSubject: x.target.value })} /></Field>
          <Field label="Text Zahlungserinnerung"><Textarea rows={6} value={e.reminderText} onChange={(x) => set({ reminderText: x.target.value })} /></Field>
        </fieldset>
      </Card>

      <Card title="Eingehende E-Mails">
        <div className="flex items-start gap-3 text-sm">
          <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-(--text-muted)" />
          <p className="text-(--text-muted)">Brevo verschickt nur – ein Postfach hat es nicht. Rechnungen, die per Mail kommen, holt Ordo am einfachsten über einen überwachten Ordner: in deinem Mailprogramm Anhänge automatisch dort speichern lassen. Ein eingebautes Postfach (IMAP) ist geplant.</p>
        </div>
      </Card>
    </div>
  );
}
