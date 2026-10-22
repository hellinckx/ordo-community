import { useState, type ComponentProps, type ReactNode } from "react";
import { ArchiveRestore, ChevronRight, FileArchive } from "lucide-react";
import { useSession } from "@/state/session";
import { Button, Field, Input, Modal } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { LegalLinks, WebsiteLink } from "@/components/LegalLinks";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { toast } from "@/state/toasts";
import { forgetOnDevice, setStayUnlocked, stayUnlockedWanted } from "@/services/deviceUnlock";
import { cls } from "@/lib/format";

/** Shared frame of the sign-in, sign-up and lock screens: plain page, Ordo logo and wordmark, card, legal links. */
export function AuthLayout({ title, subtitle, children, width = "md" }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: "sm" | "md" | "lg" }) {
  return (
    <div className="flex min-h-screen flex-col bg-(--bg)">
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-10 sm:items-center sm:pt-10">
        <div className={cls("w-full", width === "sm" ? "max-w-sm" : width === "md" ? "max-w-md" : "max-w-2xl")}>
          <div className="mb-6 flex flex-col items-center text-center">
            <WebsiteLink className="mb-6 flex items-center gap-2.5 rounded-xl px-2 py-1 transition-colors hover:bg-(--surface-2)">
              <Logo className="h-10 w-10" />
              <span className="text-[22px] font-semibold tracking-tight" aria-hidden="true">Ordo</span>
            </WebsiteLink>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-(--text-muted)">{subtitle}</p> : null}
          </div>
          {children}
        </div>
      </main>
      <footer className="flex justify-center px-4 pb-6">
        <LegalLinks />
      </footer>
      <PrivacyNotice noNav />
    </div>
  );
}

/** Text input with an icon inside on the left. */
export function IconInput({ icon, className, ...props }: ComponentProps<typeof Input> & { icon: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--text-muted) [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <Input {...props} className={cls("pl-9", className)} />
    </div>
  );
}

/** One row of the "other ways in" list under the sign-in card. */
export function OptionRow({ icon, title, body, onClick, disabled }: { icon: ReactNode; title: ReactNode; body: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-(--surface-2) disabled:opacity-60">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-(--text-muted)">{body}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-(--text-muted)" />
    </button>
  );
}

/** Restores a backup file (.ordo, older ones .summa – same format) exported under Export & Sicherung → "Verschlüsselte Komplettsicherung". */
export function RestoreBackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { importBackup, platform } = useSession();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    const files = await platform!.pickFiles({ multiple: false, accept: [".ordo", ".summa", ".summa-backup"] });
    if (files[0]) {
      setFile({ name: files[0].name, bytes: files[0].bytes });
      setError(null);
    }
  };
  const restore = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await importBackup(file.bytes, password);
      toast.success("Sicherung wiederhergestellt");
      onClose();
    } catch (e) {
      setError(/password|passwort|decrypt|entschl/i.test(String(e)) ? "Das Passwort passt nicht zu dieser Sicherung." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="inline-flex items-center gap-2"><ArchiveRestore className="h-5 w-5 text-brand-600" /> Sicherung wiederherstellen</span>}
      size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={() => void restore()} loading={busy} disabled={!file || !password}>Wiederherstellen</Button></>}
    >
      <div className="space-y-4 text-sm">
        <p className="text-(--text-muted)">
          Eine Sicherung ist eine Datei mit der Endung <strong className="text-(--text)">.ordo</strong>. Du erstellst sie in Ordo unter <strong className="text-(--text)">Export &amp; Sicherung → „Verschlüsselte Komplettsicherung“</strong> (Dateiname z. B. Ordo_Sicherung_2026-10-22.ordo). Sie enthält alle Daten, verschlüsselt mit dem Passwort, das beim Export galt. Ältere Sicherungen mit der Endung .summa funktionieren genauso.
        </p>
        <button type="button" onClick={() => void pick()} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-(--border) px-4 py-3 text-left hover:border-brand-500">
          <FileArchive className="h-5 w-5 shrink-0 text-brand-600" />
          <span className="min-w-0 flex-1 truncate">{file ? file.name : "Datei auswählen …"}</span>
        </button>
        <Field label="Passwort der Sicherung">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-200">{error}</div> : null}
        <p className="text-xs text-(--text-muted)">Achtung: Daten, die schon auf diesem Gerät sind, werden durch die Sicherung ersetzt.</p>
      </div>
    </Modal>
  );
}

/** "Angemeldet bleiben" – on by default; unticking forgets the key this device kept. */
export function StayUnlockedCheckbox() {
  const [on, setOn] = useState(stayUnlockedWanted);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-(--text-muted)" title="Ordo bleibt auf diesem Gerät auch nach dem Neuladen offen – bis du sperrst oder dich abmeldest. Auf fremden Computern ausschalten.">
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setStayUnlocked(e.target.checked); if (!e.target.checked) void forgetOnDevice(); }} />
      Angemeldet bleiben
    </label>
  );
}
