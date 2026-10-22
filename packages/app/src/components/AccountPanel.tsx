import { useEffect, useState } from "react";
import { UserX } from "lucide-react";
import { Badge, Button, ConfirmDialog, Progress } from "@/components/ui";
import { useSync } from "@/services/sync";
import { entitlements } from "@/services/plan";
import { deleteOwnAccount } from "@/services/account";
import { PARTS } from "@/operator";
import { useSession } from "@/state/session";
import { toast } from "@/state/toasts";
import { fmtBytes } from "@/lib/format";

/** Plan, storage usage and account deletion for the signed-in sync user (Settings → Sync). */
export function AccountPanel() {
  const { plan, serverSettings, ownServer, signOut } = useSync();
  const platform = useSession((s) => s.platform);
  const [usage, setUsage] = useState<{ vaultBytes: number; blobBytes: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void platform?.storage.usage?.().then(setUsage);
  }, [platform]);
  const ent = entitlements(plan, serverSettings);
  const used = usage ? usage.vaultBytes + usage.blobBytes : 0;
  const limit = ent.storageMb * 1048576;
  const deleteAccount = async () => {
    setBusy(true);
    try {
      // the operator's own server has a function for it; own databases and the community edition use the generic way
      await (!ownServer && PARTS.deleteAccount ? PARTS.deleteAccount() : deleteOwnAccount());
      await signOut();
      toast.success("Sync-Konto gelöscht", "Deine Daten und Dateien wurden vom Server entfernt. Auf diesem Gerät bleibt alles.");
    } catch (e) {
      toast.error("Löschen fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-3 border-t border-(--border) pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-(--text-muted)">Tarif</span>
        <Badge tone={plan === "free" ? "neutral" : "brand"}>{ent.label}</Badge>
        <span className="text-xs text-(--text-muted)">{ent.storageMb} MB Speicher · bis zu {ent.devices} Geräte{ent.priceEur ? ` · ${ent.priceEur.toFixed(2).replace(".", ",")} € / Monat` : " · kostenlos"}</span>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-(--text-muted)"><span>Belegt</span><span className="tabular">{usage ? `${fmtBytes(used)} von ${ent.storageMb} MB` : "…"}</span></div>
        <Progress value={Math.min(1, used / limit)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {PARTS.PlanUpgrade ? <PARTS.PlanUpgrade /> : null}
        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirmDelete(true)}><UserX className="h-4 w-4" /> Sync-Konto löschen</Button>
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title="Sync-Konto löschen?" body="Dein Konto, der verschlüsselte Tresor und die Belege werden vom Server gelöscht. Die Daten auf diesem Gerät bleiben erhalten. Das lässt sich nicht rückgängig machen." confirmLabel={busy ? "Wird gelöscht …" : "Endgültig löschen"} onConfirm={deleteAccount} />
    </div>
  );
}
