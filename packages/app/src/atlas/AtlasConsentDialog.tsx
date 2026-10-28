import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Checkbox, Modal } from "@/components/ui";
import { closeAtlasConsent, confirmAtlasConsent, useAtlasConsent } from "./consent";

/** One shared dialog, available from the chat, page actions and Atlas settings. */
export function AtlasConsentDialog() {
  const request = useAtlasConsent((s) => s.request);
  return request ? <ConsentContent key={request.id} provider={request.provider} /> : null;
}

function ConsentContent({ provider }: { provider: "claude" | "openai" | "codex" }) {
  const [accepted, setAccepted] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const providerName = provider === "claude" ? "Anthropic (Claude)" : provider === "codex" ? "OpenAI über Codex" : "OpenAI";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = content.current?.closest<HTMLElement>('[role="dialog"]');
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? [])];
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      const next = items[(items.indexOf(document.activeElement as HTMLElement) + (event.shiftKey ? -1 : 1) + items.length) % items.length];
      if (next) { event.preventDefault(); next.focus(); }
    };
    dialog?.addEventListener("keydown", trap);
    return () => { dialog?.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <Modal open onClose={closeAtlasConsent} title="Datenübertragung für Atlas erlauben" size="sm" footer={<>
    <Button variant="ghost" onClick={closeAtlasConsent}>Jetzt nicht</Button>
    <Button disabled={!accepted} onClick={confirmAtlasConsent}>Zustimmen und Atlas nutzen</Button>
  </>}>
    <div ref={content} className="space-y-4 text-sm">
      <p>Damit Atlas antworten kann, braucht er deine Einwilligung zur Datenübertragung an <strong>{providerName}</strong>.</p>
      <div className="space-y-2">
        <p className="font-medium">Was wird übertragen?</p>
        <p className="text-(--text-muted)">Deine Nachricht, der bisherige Verlauf dieses Gesprächs, von dir angehängte Dateien und die Daten, die Atlas für deine Anfrage nachschlägt. Dabei gelten deine Rolle und die eingestellten Zugriffsrechte.</p>
        <p className="text-(--text-muted)">Dein gesamter Tresor wird nicht übertragen. Passwörter und API-Keys gehören nicht zu den Gesprächsdaten.</p>
      </div>
      <p className="flex items-start gap-2 text-xs text-(--text-muted)"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />Die Einwilligung gilt für Atlas in diesem Tresor. Du kannst sie jederzeit unter Einstellungen → Atlas widerrufen. Es gelten die Datenschutzbedingungen des gewählten Anbieters.</p>
      <div className="rounded-lg focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-brand-600"><Checkbox checked={accepted} onChange={setAccepted} label={`Ich erlaube Atlas, diese Daten an ${providerName} zu senden.`} /></div>
    </div>
  </Modal>;
}
