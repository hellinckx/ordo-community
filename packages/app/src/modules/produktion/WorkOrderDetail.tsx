import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Ban, CheckCircle2, Circle, MoreHorizontal, PackageCheck, PackageMinus, Pencil, Play, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { newId, nowIso, workOrderMaterialMoves, workOrderProgress, type WorkOrder, type WorkOrderStep } from "@ordo/core";
import { useContactMap, useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useIsInstalled } from "@/modules/registry";
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Menu, PageHeader, Progress, Select, Textarea } from "@/components/ui";
import { cls, fmtDate, fmtDateTime, fmtPct } from "@/lib/format";
import { toast } from "@/state/toasts";
import { fmtQty, QtyInput, useProducts } from "@/modules/produkte/shared";
import { bookWorkOrderMaterials, returnWorkOrderMaterials, setWorkOrderStatus } from "./actions";
import { CompleteDialog } from "./CompleteDialog";
import { MaterialCheck } from "./MaterialCheck";
import { dueInfo, fmtMinutes, MemberAvatar, PRIORITY_LABELS, PriorityBadge, StatusBadge, useMembers, useProductionAccess } from "./shared";
import { WorkOrderDialog } from "./WorkOrderDialog";

export default function WorkOrderDetail() {
  const { id = "" } = useParams();
  const workOrders = useList("workOrders");
  const wo = workOrders.find((w) => w.id === id);
  if (!wo) {
    return (
      <div>
        <BackLink />
        <EmptyState title="Fertigungsauftrag nicht gefunden" body="Vielleicht wurde er gelöscht." action={<Link to="/produktion"><Button variant="outline">Zu den Fertigungsaufträgen</Button></Link>} />
      </div>
    );
  }
  return <Detail wo={wo} />;
}

function BackLink() {
  return (
    <Link to="/produktion" className="mb-3 inline-flex items-center gap-1 text-sm text-(--text-muted) hover:text-(--text)">
      <ArrowLeft className="h-4 w-4" /> Fertigungsaufträge
    </Link>
  );
}

function Detail({ wo }: { wo: WorkOrder }) {
  const profile = useProfile();
  const navigate = useNavigate();
  const products = useProducts();
  const members = useMembers();
  const contacts = useContactMap();
  const projects = useList("projects");
  const moves = useList("stockMoves");
  const projekte = useIsInstalled("projekte");
  const access = useProductionAccess();
  const product = products.find((p) => p.id === wo.productId);
  const progress = workOrderProgress(wo);
  const due = dueInfo(wo);
  const project = wo.projectId ? projects.find((p) => p.id === wo.projectId) : undefined;
  const myMoves = useMemo(() => moves.filter((m) => m.workOrderId === wo.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [moves, wo.id]);
  const output = myMoves.filter((m) => m.kind === "production_in");
  const taken = myMoves.filter((m) => m.kind === "production_out");
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmMaterials, setConfirmMaterials] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [returnMaterials, setReturnMaterials] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [notes, setNotes] = useState(wo.notes);
  useEffect(() => setNotes(wo.notes), [wo.notes]);
  const open = wo.status === "planned" || wo.status === "released" || wo.status === "in_progress";
  const plannedMaterial = useMemo(() => (product ? workOrderMaterialMoves(wo, product, products, "") : []), [wo, product, products]);

  const canEditStep = (s: WorkOrderStep) => access.canWrite || (access.canOwn && !!access.me && s.memberId === access.me.id);
  const updateSteps = (fn: (steps: WorkOrderStep[]) => WorkOrderStep[], audit = "workOrder.step") =>
    requireStore().update(
      "workOrders",
      wo.id,
      (w) => {
        const steps = fn(w.steps);
        const anyDone = steps.some((s) => s.done);
        const autoStart = anyDone && (w.status === "planned" || w.status === "released");
        return { ...w, steps, status: autoStart ? "in_progress" : w.status, startedAt: autoStart && !w.startedAt ? nowIso() : w.startedAt };
      },
      audit,
    );
  const toggleStep = (s: WorkOrderStep, done: boolean) =>
    updateSteps((steps) => steps.map((x) => (x.id === s.id ? { ...x, done, doneAt: done ? nowIso() : undefined, actualMinutes: done && !x.actualMinutes ? x.plannedMinutes : x.actualMinutes } : x)));
  const patchStep = (id: string, patch: Partial<WorkOrderStep>) => updateSteps((steps) => steps.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addStep = () => updateSteps((steps) => [...steps, { id: newId("wos"), name: "", plannedMinutes: 0, actualMinutes: 0, workCenter: "", done: false }], "workOrder.stepAdd");
  const removeStep = (id: string) => updateSteps((steps) => steps.filter((x) => x.id !== id), "workOrder.stepRemove");

  const statusAction = (() => {
    if (!access.canWrite) return null;
    if (wo.status === "planned") return <Button onClick={() => { setWorkOrderStatus(wo, "released"); toast.success("Freigegeben", "Der Auftrag kann jetzt gestartet werden."); }}><Send className="h-4 w-4" /> Freigeben</Button>;
    if (wo.status === "released") return <Button onClick={() => { setWorkOrderStatus(wo, "in_progress"); toast.success("Gestartet"); }}><Play className="h-4 w-4" /> Starten</Button>;
    if (wo.status === "in_progress") return <Button onClick={() => setCompleting(true)}><PackageCheck className="h-4 w-4" /> Fertigmelden</Button>;
    if (wo.status === "done") return <Button variant="outline" onClick={() => setConfirmReopen(true)}><RotateCcw className="h-4 w-4" /> Wieder öffnen</Button>;
    return <Button variant="outline" onClick={() => setWorkOrderStatus(wo, "planned")}><RotateCcw className="h-4 w-4" /> Wiederherstellen</Button>;
  })();

  return (
    <div className="space-y-5">
      <BackLink />
      <PageHeader
        title={<span>{product?.name ?? "Gelöschtes Produkt"} <span className="font-normal text-(--text-muted)">× {fmtQty(wo.quantity)} {product?.unit}</span></span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{wo.number}</span>
            <StatusBadge status={wo.status} />
            <PriorityBadge priority={wo.priority} />
            {due ? <span className={cls(due.tone === "danger" && "text-red-600 dark:text-red-400", due.tone === "warning" && "text-amber-700 dark:text-amber-400")}>{wo.status === "done" ? `fällig war ${due.label}` : due.label}</span> : null}
          </span>
        }
        actions={
          <>
            {statusAction}
            {access.canWrite ? (
              <Menu
                trigger={<Button variant="outline" size="icon" aria-label="Mehr"><MoreHorizontal className="h-4 w-4" /></Button>}
                items={[
                  { label: "Bearbeiten", icon: <Pencil className="h-4 w-4" />, onClick: () => setEditing(true) },
                  ...(wo.status === "in_progress" ? [{ label: "Zurück auf Freigegeben", icon: <RotateCcw className="h-4 w-4" />, onClick: () => setWorkOrderStatus(wo, "released") }] : []),
                  ...(open ? [{ label: "Stornieren", icon: <Ban className="h-4 w-4" />, danger: true, onClick: () => { setReturnMaterials(true); setConfirmCancel(true); } }] : []),
                  ...(access.canAdmin ? [{ label: "Löschen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
                ]}
              />
            ) : null}
          </>
        }
      />

      {access.canWrite && wo.status === "in_progress" && progress.allDone ? (
        <div className="surface flex flex-wrap items-center gap-3 p-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <span className="min-w-0 flex-1 text-sm"><span className="font-medium">Alle Schritte erledigt.</span> <span className="text-(--text-muted)">Jetzt fertigmelden, dann kommt die Ware ins Lager.</span></span>
          <Button size="sm" onClick={() => setCompleting(true)}>Fertigmelden</Button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Arbeitsschritte" padded={false} action={access.canWrite && wo.status !== "done" && wo.status !== "cancelled" ? <Button size="sm" variant="outline" onClick={addStep}><Plus className="h-4 w-4" /> Schritt</Button> : undefined}>
            {wo.steps.length ? (
              <ul className="divide-y divide-(--border)">
                {wo.steps.map((s) => (
                  <StepRow key={s.id} step={s} editable={canEditStep(s) && wo.status !== "cancelled"} manage={access.canWrite && wo.status !== "cancelled"} members={members} onToggle={(d) => toggleStep(s, d)} onPatch={(p) => patchStep(s.id, p)} onRemove={() => removeStep(s.id)} />
                ))}
              </ul>
            ) : (
              <div className="px-5 py-8 text-center text-sm text-(--text-muted)">Keine Arbeitsschritte. {access.canWrite ? "Füg welche hinzu oder hinterleg sie in der Stückliste des Produkts." : ""}</div>
            )}
            {wo.steps.length ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--border) px-5 py-3 text-xs text-(--text-muted)">
                <span>{progress.done} von {progress.total} erledigt</span>
                <span className="tabular">Geplant {fmtMinutes(progress.plannedMinutes)} · Ist {fmtMinutes(progress.actualMinutes)}{progress.plannedMinutes && progress.actualMinutes ? ` (${fmtPct(progress.actualMinutes / progress.plannedMinutes)})` : ""}</span>
              </div>
            ) : null}
          </Card>

          <Card
            title="Material"
            action={access.canWrite && !wo.materialsBooked && plannedMaterial.length && wo.status !== "cancelled" ? <Button size="sm" variant="outline" onClick={() => setConfirmMaterials(true)}><PackageMinus className="h-4 w-4" /> Material entnehmen</Button> : undefined}
          >
            {wo.materialsBooked ? (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Material ist aus dem Lager entnommen.</p>
                {taken.length ? (
                  <ul className="divide-y divide-(--border) rounded-xl border border-(--border) text-sm">
                    {taken.map((m) => {
                      const p = products.find((x) => x.id === m.productId);
                      return (
                        <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                          <Link to={`/produkte/${m.productId}?tab=bestand`} className="truncate hover:underline">{p?.name ?? "Gelöschter Artikel"}</Link>
                          <span className="shrink-0 tabular text-(--text-muted)">{fmtQty(Math.abs(m.quantity))} {p?.unit} · {fmtDate(m.date)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : product ? (
              <MaterialCheck product={product} quantity={wo.quantity} />
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Überblick">
            <div className="mb-4">
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="text-(--text-muted)">Fortschritt</span>
                <span className="tabular font-semibold">{fmtPct(progress.ratio)}</span>
              </div>
              <Progress value={progress.ratio} />
            </div>
            <dl className="space-y-2.5 text-sm">
              <Row label="Produkt">{product ? <Link to={`/produkte/${product.id}`} className="hover:underline">{product.name}</Link> : "–"}</Row>
              <Row label="Menge">{fmtQty(wo.quantity)} {product?.unit}</Row>
              <Row label="Start geplant">{fmtDate(wo.plannedStart)}</Row>
              <Row label="Fällig am">{fmtDate(wo.dueDate)}</Row>
              <Row label="Priorität">{PRIORITY_LABELS[wo.priority]}</Row>
              {wo.customerId ? <Row label="Kunde"><Link to={`/kontakte/${wo.customerId}`} className="hover:underline">{contacts.get(wo.customerId)?.name ?? "–"}</Link></Row> : null}
              {project ? <Row label="Projekt">{projekte ? <Link to={`/projekte/${project.id}`} className="hover:underline">{project.name}</Link> : project.name}</Row> : null}
              {wo.startedAt ? <Row label="Gestartet">{fmtDateTime(wo.startedAt)}</Row> : null}
              {wo.completedAt ? <Row label="Fertig">{fmtDateTime(wo.completedAt)}</Row> : null}
            </dl>
            {wo.assigneeIds.length ? (
              <div className="mt-4 border-t border-(--border) pt-3">
                <div className="mb-2 text-xs font-medium text-(--text-muted)">Zuständig</div>
                <div className="flex flex-wrap gap-2">
                  {wo.assigneeIds.map((id) => {
                    const m = members.find((x) => x.id === id);
                    return m ? <span key={id} className="inline-flex items-center gap-1.5 text-sm"><MemberAvatar member={m} className="ring-0" />{m.name}</span> : null;
                  })}
                </div>
              </div>
            ) : null}
          </Card>

          <Card title="Fertigmeldung">
            {wo.outputBooked ? (
              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-emerald-600" /> Im Lager gebucht</p>
                {output.map((m) => <p key={m.id} className="text-(--text-muted)">{fmtQty(m.quantity)} {product?.unit} am {fmtDate(m.date)}</p>)}
                {product ? <Link to={`/produkte/${product.id}?tab=bestand`} className="text-sm text-brand-700 hover:underline dark:text-brand-400">Bestand ansehen</Link> : null}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-(--text-muted)">Wenn alles fertig ist, bucht die Fertigmeldung die Ware ins Lager und schließt den Auftrag ab.</p>
                {access.canWrite && open ? <Button variant={wo.status === "in_progress" ? "primary" : "outline"} className="w-full justify-center" onClick={() => setCompleting(true)}><PackageCheck className="h-4 w-4" /> Fertigmelden</Button> : null}
              </div>
            )}
          </Card>

          <Card title="Notizen">
            {access.canWrite ? (
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== wo.notes && requireStore().update("workOrders", wo.id, { notes }, "workOrder.notes")} rows={4} placeholder="Hinweise fürs Team, Freigaben, Besonderheiten …" />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-(--text-muted)">{wo.notes || "Keine Notizen."}</p>
            )}
          </Card>
        </div>
      </div>

      <WorkOrderDialog open={editing} onClose={() => setEditing(false)} workOrder={wo} />
      <CompleteDialog open={completing} onClose={() => setCompleting(false)} workOrder={completing ? wo : null} />
      <ConfirmDialog
        open={confirmMaterials}
        onClose={() => setConfirmMaterials(false)}
        title="Material entnehmen?"
        confirmLabel="Entnehmen"
        body={
          <div className="space-y-2">
            <p>Ordo bucht dieses Material für {wo.number} aus dem Lager:</p>
            <ul className="space-y-0.5 text-xs">
              {plannedMaterial.map((m) => {
                const p = products.find((x) => x.id === m.productId);
                return <li key={m.productId} className="flex justify-between gap-2"><span className="truncate">{p?.name}</span><span className="tabular">{fmtQty(Math.abs(m.quantity))} {p?.unit}</span></li>;
              })}
            </ul>
          </div>
        }
        onConfirm={() => {
          if (!product) return;
          const n = bookWorkOrderMaterials(wo, product, products, profile.id);
          toast.success("Material entnommen", `${n} ${n === 1 ? "Bewegung" : "Bewegungen"} gebucht.`);
        }}
      />
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        danger
        title="Auftrag stornieren?"
        confirmLabel="Stornieren"
        body={
          <div className="space-y-3">
            <p>Der Auftrag bleibt erhalten, wird aber nicht mehr gefertigt.</p>
            {wo.materialsBooked && taken.length ? <Checkbox checked={returnMaterials} onChange={setReturnMaterials} label="Entnommenes Material zurück ins Lager buchen" /> : null}
          </div>
        }
        onConfirm={() => {
          if (wo.materialsBooked && taken.length && returnMaterials) returnWorkOrderMaterials(wo, profile.id, moves);
          setWorkOrderStatus(wo, "cancelled");
          toast.success("Storniert", wo.number);
        }}
      />
      <ConfirmDialog
        open={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        title="Wieder öffnen?"
        confirmLabel="Wieder öffnen"
        body="Der Auftrag geht zurück auf „In Arbeit“. Bereits gebuchtes Material und die Fertigware bleiben im Lager gebucht."
        onConfirm={() => setWorkOrderStatus(wo, "in_progress")}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title={`${wo.number} löschen?`}
        confirmLabel="Löschen"
        body={myMoves.length ? "Die Lagerbewegungen dieses Auftrags bleiben gebucht. Wenn du sie rückgängig machen willst, storniere den Auftrag vorher." : "Der Auftrag wird gelöscht."}
        onConfirm={() => {
          requireStore().softDelete("workOrders", wo.id, "workOrder.delete");
          toast.success("Gelöscht", wo.number);
          navigate("/produktion");
        }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-(--text-muted)">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function StepRow({ step, editable, manage, members, onToggle, onPatch, onRemove }: { step: WorkOrderStep; editable: boolean; manage: boolean; members: ReturnType<typeof useMembers>; onToggle: (done: boolean) => void; onPatch: (p: Partial<WorkOrderStep>) => void; onRemove: () => void }) {
  const [name, setName] = useState(step.name);
  useEffect(() => setName(step.name), [step.name]);
  const member = members.find((m) => m.id === step.memberId);
  return (
    <li className={"flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3"}>
      <button type="button" disabled={!editable} onClick={() => onToggle(!step.done)} className="shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50" aria-label={step.done ? "Als offen markieren" : "Als erledigt markieren"}>
        {step.done ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <Circle className="h-6 w-6 text-slate-300 dark:text-slate-600" />}
      </button>
      <div className="min-w-0 flex-1 basis-40">
        {manage ? (
          <Input value={name} placeholder="Name des Schritts" onChange={(e) => setName(e.target.value)} onBlur={() => name !== step.name && onPatch({ name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={cls("h-9", step.done && "text-(--text-muted) line-through")} />
        ) : (
          <div className={cls("truncate text-sm font-medium", step.done && "text-(--text-muted) line-through")}>{step.name || "Schritt"}</div>
        )}
        <div className="mt-0.5 truncate text-xs text-(--text-muted)">
          {[step.workCenter, step.done && step.doneAt ? `erledigt ${fmtDateTime(step.doneAt)}` : ""].filter(Boolean).join(" · ") || " "}
        </div>
      </div>
      <div className="w-40 max-sm:flex-1">
        {manage && members.length ? (
          <Select value={step.memberId ?? ""} onChange={(e) => onPatch({ memberId: e.target.value || undefined })} className="h-9 text-[13px]" aria-label="Wer">
            <option value="">Noch offen</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm">{member ? <><MemberAvatar member={member} className="ring-0" />{member.name}</> : <span className="text-(--text-muted)">Noch offen</span>}</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-(--text-muted)">
        {manage ? (
          <div className="w-24" title="Geplant"><QtyInput value={step.plannedMinutes} commit="blur" suffix="min" onChange={(n) => n !== step.plannedMinutes && onPatch({ plannedMinutes: Math.round(n) })} className="h-9" aria-label="Geplante Minuten" /></div>
        ) : (
          <span className="tabular">Plan {fmtMinutes(step.plannedMinutes)}</span>
        )}
        <span>Ist</span>
        {editable ? (
          <div className="w-24"><QtyInput value={step.actualMinutes} commit="blur" suffix="min" onChange={(n) => n !== step.actualMinutes && onPatch({ actualMinutes: Math.round(n) })} className="h-9" aria-label="Tatsächliche Minuten" /></div>
        ) : (
          <span className="tabular">{fmtMinutes(step.actualMinutes)}</span>
        )}
      </div>
      {manage ? <button onClick={onRemove} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2) hover:text-red-600" aria-label="Schritt entfernen"><Trash2 className="h-4 w-4" /></button> : null}
      {step.done && step.actualMinutes > step.plannedMinutes * 1.2 && step.plannedMinutes > 0 ? <Badge tone="warning">länger als geplant</Badge> : null}
    </li>
  );
}
