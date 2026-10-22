import { useState, type FormEvent } from "react";
import { create } from "zustand";
import { Briefcase, Building2, User } from "lucide-react";
import { ids, nowIso, type Mode, type Profile } from "@ordo/core";
import { requireStore } from "@/state/session";
import { MAX_PROFILES } from "@/config";
import { Button, Field, Input, Modal } from "@/components/ui";
import { toast } from "@/state/toasts";
import { cls } from "@/lib/format";

/** Opened from the profile switcher, the account menu and the settings page. */
export const useAddProfileDialog = create<{ open: boolean; show(mode?: Mode): void; hide(): void; mode: Mode }>((set) => ({
  open: false,
  mode: "business",
  show: (mode) => set({ open: true, mode: mode ?? "business" }),
  hide: () => set({ open: false }),
}));

export function activeProfileCount(): number {
  return requireStore().vault.profiles.filter((p) => !p.deletedAt).length;
}

/** New profile in the same vault: tax settings start from the active profile, company data empty. */
export function createProfile(mode: Mode, name: string): Profile {
  const store = requireStore();
  if (activeProfileCount() >= MAX_PROFILES) throw new Error(`Maximal ${MAX_PROFILES} Profile pro Konto.`);
  const base = store.activeProfile;
  const now = nowIso();
  const np: Profile = {
    ...base,
    id: ids.profile(),
    name,
    mode,
    vatRegime: mode === "business" ? "regelbesteuerung" : "kleinunternehmer",
    uvaPeriod: mode === "business" ? "quarterly" : "none",
    company: { ...base.company, name: mode === "business" ? name : "", uid: "", steuernummer: "", iban: "", bic: "", nextInvoiceNumber: 1, logoAttachmentId: undefined },
    color: "#0f766e",
    createdAt: now,
    updatedAt: now,
  };
  store.insert("profiles", np, "profile.create");
  store.setActiveProfile(np.id);
  return np;
}

export function AddProfileDialog() {
  const { open, hide, mode: initialMode } = useAddProfileDialog();
  return open ? <AddProfileForm key={initialMode} initialMode={initialMode} onClose={hide} /> : null;
}

function AddProfileForm({ initialMode, onClose }: { initialMode: Mode; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const full = activeProfileCount() >= MAX_PROFILES;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (full || !name.trim()) return;
    try {
      const p = createProfile(mode, name.trim());
      toast.success("Profil angelegt", `„${p.name}“ ist jetzt geöffnet. Wechseln kannst du jederzeit im Menü rechts oben.`);
      onClose();
    } catch (err) {
      toast.error("Profil nicht angelegt", err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Profil hinzufügen"
      footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={() => submit()} disabled={full || !name.trim()}>Anlegen</Button></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-(--text-muted)">Firma und Privat getrennt, alles in einem Konto.</p>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-(--surface-2) p-1">
          {(["business", "employee"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cls("flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors", mode === m ? "bg-(--surface) shadow-sm" : "text-(--text-muted) hover:text-(--text)")}>
              {m === "business" ? <Briefcase className="h-4 w-4" /> : <User className="h-4 w-4" />}
              {m === "business" ? "Firma" : "Privat"}
            </button>
          ))}
        </div>
        <Field label={mode === "business" ? "Firmenname" : "Name"}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--text-muted)">{mode === "business" ? <Building2 className="h-4 w-4" /> : <User className="h-4 w-4" />}</span>
            <Input autoFocus className="pl-9" value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "business" ? "z. B. Muster GmbH" : "z. B. Anna Berger"} />
          </div>
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        {full ? <p className="text-sm text-amber-700 dark:text-amber-300">Mehr als {MAX_PROFILES} Profile gehen nicht. Lösche zuerst eines unter Einstellungen → Profil.</p> : null}
      </form>
    </Modal>
  );
}
