import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { afaSchedule, anlagenverzeichnis, ids, nowIso, todayIso, CHART_OF_ACCOUNTS, type Asset } from "@ordo/core";
import { useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { Badge, Button, ConfirmDialog, DateInput, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, Textarea } from "@/components/ui";
import { cls, fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";

export default function Assets() {
  const assets = useList("assets");
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [creating, setCreating] = useState(false);
  const verz = useMemo(() => anlagenverzeichnis(assets, year), [assets, year]);
  const years = useMemo(() => {
    const ys = new Set<number>([new Date().getFullYear()]);
    for (const a of assets) for (const r of afaSchedule(a)) ys.add(r.year);
    return [...ys].sort((a, b) => b - a);
  }, [assets]);
  return (
    <div className="space-y-4">
      <PageHeader title="Anlagen & Abschreibung" subtitle="Größere Anschaffungen wie Laptop, Auto oder Maschinen – Summa verteilt die Kosten richtig auf die Jahre (AfA)." actions={<><Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Anlage</Button></>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`AfA ${year} (KZ 9130)`} value={fmtMoney(verz.afaTotalCents)} />
        <Stat label={`Restbuchwert 31.12.${year}`} value={fmtMoney(verz.bookValueTotalCents)} />
        <Stat label="Anlagen" value={verz.rows.length} />
      </div>
      {!assets.length ? (
        <EmptyState icon={<Package className="h-8 w-8" />} title="Keine Anlagen" body="Käufe über 1.000 € netto (Laptop, Maschinen, Fahrzeuge) werden über die Nutzungsdauer abgeschrieben. Buche sie mit der Kategorie „Anlagenkauf“ – Summa legt die Anlage automatisch an." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Manuell anlegen</Button>} />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="w-8" /><th className="px-3 py-2">Anlage</th><th className="px-3 py-2">Anschaffung</th><th className="px-3 py-2 text-right">Kosten</th><th className="px-3 py-2">ND</th><th className="px-3 py-2 text-right">AfA {year}</th><th className="px-3 py-2 text-right">Buchwert</th><th className="w-20" /></tr></thead>
            <tbody className="divide-y divide-(--border)">
              {verz.rows.map(({ asset: a, ...r }) => (
                <AssetRow key={a.id} asset={a} afa={r.afaCents} book={r.bookValueEndCents} mode={r.mode} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onEdit={() => setEditing(a)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AssetDialog open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} asset={editing ?? undefined} />
    </div>
  );
}

function AssetRow({ asset: a, afa, book, mode, open, onToggle, onEdit }: { asset: Asset; afa: number; book: number; mode: string; open: boolean; onToggle: () => void; onEdit: () => void }) {
  const schedule = afaSchedule(a);
  return (
    <>
      <tr className={cls("hover:bg-(--surface-2)", a.disposedAt && "opacity-60")}>
        <td className="px-2"><button onClick={onToggle} className="rounded p-1 text-(--text-muted)">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
        <td className="px-3 py-2"><div className="font-medium">{a.name}</div><div className="text-xs text-(--text-muted)">{a.method === "gwg" ? "GWG" : a.method === "degressive" ? `degressiv ${a.degressiveRatePct} %` : "linear"}{a.privateUsePct ? ` · ${a.privateUsePct} % privat` : ""}{a.disposedAt ? ` · abgegangen ${fmtDate(a.disposedAt)}` : ""}</div></td>
        <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(a.acquisitionDate)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular">{fmtMoney(a.costCents)}</td>
        <td className="whitespace-nowrap px-3 py-2">{a.method === "gwg" ? "–" : `${a.usefulLifeYears} J.`}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular">{fmtMoney(afa)}{mode === "halb" ? <Badge className="ml-1">½</Badge> : null}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular">{fmtMoney(book)}</td>
        <td className="px-2 text-right"><button className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface)" onClick={onEdit}><Pencil className="h-4 w-4" /></button></td>
      </tr>
      {open ? (
        <tr><td colSpan={8} className="bg-(--surface-2) px-6 py-3">
          <table className="w-full max-w-lg text-xs">
            <thead><tr className="text-left text-(--text-muted)"><th className="py-1">Jahr</th><th className="py-1 text-right">AfA</th><th className="py-1 text-right">Buchwert Ende</th><th className="py-1">Modus</th></tr></thead>
            <tbody>{schedule.map((r) => <tr key={r.year} className="border-t border-(--border)"><td className="py-1">{r.year}</td><td className="py-1 text-right tabular">{fmtMoney(r.afaCents)}</td><td className="py-1 text-right tabular">{fmtMoney(r.bookValueEndCents)}</td><td className="py-1">{r.mode === "halb" ? "Halbjahres-AfA" : r.mode === "gwg" ? "Sofortabschreibung" : "Ganzjahres-AfA"}{r.bookValueAtDisposalCents ? ` · Abgang (Restbuchwert ${fmtMoney(r.bookValueAtDisposalCents)})` : ""}</td></tr>)}</tbody>
          </table>
        </td></tr>
      ) : null}
    </>
  );
}

function AssetDialog({ open, onClose, asset }: { open: boolean; onClose: () => void; asset?: Asset }) {
  const profile = useProfile();
  const blank = (): Asset => ({ id: ids.asset(), profileId: profile.id, name: "", acquisitionDate: todayIso(), costCents: 0, usefulLifeYears: 4, method: "linear", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0620", notes: "", createdAt: nowIso(), updatedAt: nowIso() });
  const [v, setV] = useState<Asset>(asset ?? blank());
  const [confirmDelete, setConfirmDelete] = useState(false);
  useMemo(() => { if (open) setV(asset ?? blank()); }, [open, asset]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Asset>) => setV({ ...v, ...p });
  const save = () => {
    if (!v.name.trim() || !v.costCents) {
      toast.warning("Name und Anschaffungskosten sind nötig.");
      return;
    }
    const store = requireStore();
    if (asset) store.update("assets", asset.id, { ...v, updatedAt: nowIso() });
    else store.insert("assets", v, "asset.create");
    onClose();
  };
  const assetAccounts = CHART_OF_ACCOUNTS.filter((a) => a.number.startsWith("0"));
  return (
    <Modal open={open} onClose={onClose} title={asset ? "Anlage bearbeiten" : "Neue Anlage"} size="lg" footer={<>{asset ? <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button> : null}<Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save}>Speichern</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bezeichnung" required className="sm:col-span-2"><Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Anschaffungsdatum"><DateInput value={v.acquisitionDate} onChange={(d) => set({ acquisitionDate: d ?? todayIso() })} /></Field>
        <Field label="Anschaffungskosten (netto, bzw. brutto ohne Vorsteuerabzug)"><MoneyInput value={v.costCents || null} onChange={(c) => set({ costCents: c ?? 0 })} /></Field>
        <Field label="Methode"><Select value={v.method} onChange={(e) => set({ method: e.target.value as Asset["method"], usefulLifeYears: e.target.value === "gwg" ? 1 : v.usefulLifeYears })}><option value="linear">Linear (§ 7 Abs. 1)</option><option value="degressive">Degressiv (§ 7 Abs. 1a, max. 30 %)</option><option value="gwg">GWG – Sofortabschreibung (§ 13)</option></Select></Field>
        {v.method !== "gwg" ? <Field label="Nutzungsdauer (Jahre)" hint="PKW 8, EDV 3–4, Büromöbel 10, Gebäude 40 (2,5 %)"><Input type="number" min={1} max={100} value={v.usefulLifeYears} onChange={(e) => set({ usefulLifeYears: Number(e.target.value) || 1 })} /></Field> : null}
        {v.method === "degressive" ? <Field label="Degressiver Satz (%)"><Input type="number" min={1} max={30} value={v.degressiveRatePct} onChange={(e) => set({ degressiveRatePct: Number(e.target.value) || 30 })} /></Field> : null}
        <Field label="Privatanteil (%)" hint="Mindert die abzugsfähige AfA (KZ 9240/9260)"><Input type="number" min={0} max={100} value={v.privateUsePct} onChange={(e) => set({ privateUsePct: Number(e.target.value) || 0 })} /></Field>
        <Field label="EKR-Konto"><Select value={v.ekrAccount} onChange={(e) => set({ ekrAccount: e.target.value })}>{assetAccounts.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</Select></Field>
        <Field label="Abgang am (optional)"><DateInput value={v.disposedAt} onChange={(d) => set({ disposedAt: d })} /></Field>
        {v.disposedAt ? <Field label="Veräußerungserlös"><MoneyInput value={v.disposalProceedsCents ?? null} onChange={(c) => set({ disposalProceedsCents: c ?? undefined })} /></Field> : null}
        <Field label="Notizen" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title="Anlage löschen?" confirmLabel="Löschen" onConfirm={() => { requireStore().softDelete("assets", v.id); onClose(); }} />
    </Modal>
  );
}
