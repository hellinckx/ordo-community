import { useEffect, useState } from "react";
import { Paperclip, Send } from "lucide-react";
import type { Invoice } from "@ordo/core";
import { useContactMap, useProfile, useSettings } from "@/state/hooks";
import { Button, Field, Input, Modal, Textarea } from "@/components/ui";
import { toast } from "@/state/toasts";
import { fillInvoiceText, invoiceRecipient, sendInvoiceMail } from "@/services/email/send";

/** Sends a finished invoice – or a payment reminder for it – by e-mail, with the PDF attached. */
export function InvoiceMailDialog({ invoice, reminder, onClose }: { invoice: Invoice | null; reminder?: boolean; onClose: () => void }) {
  const settings = useSettings().email;
  const profile = useProfile();
  const contacts = useContactMap();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!invoice) return;
    setTo(invoiceRecipient(invoice, contacts));
    setSubject(fillInvoiceText(reminder ? settings.reminderSubject : settings.invoiceSubject, invoice, profile));
    setText(fillInvoiceText(reminder ? settings.reminderText : settings.invoiceText, invoice, profile));
  }, [invoice?.id, reminder]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!invoice) return null;

  const send = async () => {
    setBusy(true);
    try {
      await sendInvoiceMail(invoice, { to, subject, text, reminder });
      toast.success(reminder ? "Zahlungserinnerung verschickt" : `Rechnung ${invoice.number} verschickt`, `an ${to}`);
      onClose();
    } catch (e) {
      toast.error("Nicht verschickt", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={reminder ? `Zahlungserinnerung zu ${invoice.number}` : `Rechnung ${invoice.number} per E-Mail`}
      footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button loading={busy} disabled={!to.trim()} onClick={() => void send()}><Send className="h-4 w-4" /> Senden</Button></>}
    >
      <div className="space-y-3">
        <Field label="An" hint={invoice.emailedTo && !reminder ? `Zuletzt an ${invoice.emailedTo} geschickt.` : undefined}>
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="E-Mail-Adresse des Kunden" autoFocus={!to} />
        </Field>
        <Field label="Betreff"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Text"><Textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="flex items-center gap-2 rounded-xl bg-(--surface-2) px-3 py-2 text-sm"><Paperclip className="h-4 w-4 text-(--text-muted)" /> {invoice.number}.pdf</div>
        <p className="text-xs text-(--text-muted)">Geht über dein Brevo-Konto von {settings.senderEmail || "deiner Absender-Adresse"}{settings.bccSelf ? ", eine Kopie an dich" : ""}.</p>
      </div>
    </Modal>
  );
}
