import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Check, Lock, Smartphone } from "lucide-react";
import { useVault } from "@/state/hooks";
import { ALL_MODULES, installModule, isAllowed, isInstalled, moduleById, uninstallModule, useModuleAccess } from "@/modules/registry";
import type { OrdoModule } from "@/modules/types";
import { ModuleTile } from "@/components/Sidebar";
import { Badge, Button, ConfirmDialog, PageHeader } from "@/components/ui";
import { toast } from "@/state/toasts";
import { cls } from "@/lib/format";

/** Ordo is the accounting app; everything beyond its required core is an optional add-on. */
export default function Modules() {
  const vault = useVault();
  const access = useModuleAccess();
  const navigate = useNavigate();
  const { id } = useParams();
  const focus = id ? moduleById(id) : undefined;
  const [removing, setRemoving] = useState<OrdoModule | null>(null);
  const accounting = moduleById("summa")!;
  const addons = ALL_MODULES.filter((m) => !m.required);

  const install = (m: OrdoModule) => {
    installModule(m.id);
    toast.success(`${m.name} aktiviert`, "Du findest das Add-on jetzt links im Menü.");
    const first = m.nav[0];
    if (first) navigate(first.to);
  };

  return (
    <div className="mx-auto max-w-5xl pb-16">
      <PageHeader title="Add-ons" subtitle="Ordo ist deine Buchhaltungs-App. Ergänze nur die Funktionen, die du zusätzlich brauchst. Deine Daten bleiben beim Deaktivieren erhalten." />
      <section aria-label="Ordo Buchhaltung" className="surface mb-7 p-5">
        <div className="flex items-start gap-4">
          <ModuleTile module={accounting} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-[17px] font-semibold tracking-tight">Ordo · Buchhaltung</h2><Badge tone="brand">immer dabei</Badge></div>
            <p className="mt-1 text-sm text-(--text-muted)">Rechnungen, Einnahmen und Ausgaben, Kontoauszüge, Steuern, Analysen und Anlagen. Dazu Atlas, Kontakte, Dateien und Datensicherung. Die Buchhaltung ist fester Bestandteil von Ordo.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/einstellungen")}>Allgemeine Einstellungen</Button>
          </div>
        </div>
      </section>
      {focus && !isInstalled(vault.settings, focus) ? (
        <div className="mb-6 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-900 dark:bg-brand-950/50 dark:text-brand-100">
          Diese Seite gehört zum Add-on <strong>{focus.name}</strong>. Aktiviere es, um sie zu nutzen.
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {addons.map((m) => {
          const installed = isInstalled(vault.settings, m);
          const allowed = isAllowed(access, m.id);
          const missing = (m.requires ?? []).filter((r) => !isInstalled(vault.settings, moduleById(r)!)).map((r) => moduleById(r)!.name);
          return (
            <section key={m.id} className={cls("surface flex flex-col p-5", focus?.id === m.id && "ring-2 ring-brand-500")}>
              <div className="flex items-start gap-4">
                <ModuleTile module={m} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[17px] font-semibold tracking-tight">{m.name}</h2>
                    {installed ? <Badge tone="success"><Check className="mr-0.5 h-3 w-3" />aktiviert</Badge> : <Badge tone="neutral">optional</Badge>}
                  </div>
                  <div className="text-sm text-(--text-muted)">{m.title}</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-(--text-muted)">{m.description}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {m.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />{f}</li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                {m.mobile ? <span className="inline-flex items-center gap-1 text-xs text-(--text-muted)"><Smartphone className="h-3.5 w-3.5" /> auch am Handy</span> : null}
                {m.modes?.length === 1 && m.modes[0] === "business" ? <span className="text-xs text-(--text-muted)">· für Firmen-Profile</span> : null}
                <span className="flex-1" />
                {m.required ? null : !allowed ? (
                  <span className="inline-flex items-center gap-1 text-xs text-(--text-muted)"><Lock className="h-3.5 w-3.5" /> Für dein Konto nicht freigeschaltet</span>
                ) : installed ? (
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(m)}>Deaktivieren</Button>
                ) : (
                  <Button size="sm" onClick={() => install(m)}>{missing.length ? `Mit ${missing.join(", ")} aktivieren` : "Aktivieren"}</Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`${removing?.name} deaktivieren?`}
        body="Das Add-on verschwindet aus dem Menü. Deine Daten bleiben gespeichert und sind nach erneutem Aktivieren wieder da."
        confirmLabel="Deaktivieren"
        onConfirm={() => { if (removing) uninstallModule(removing.id); }}
      />
    </div>
  );
}
