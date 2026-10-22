/** Connections in the vault (settings.integrations): create, change, remove, log a run. */
import { IntegrationSchema, nowIso, withLog, type Integration, type IntegrationKind } from "@ordo/core";
import { requireStore, useSession } from "@/state/session";
import { randomSecret } from "./http";

export function integrations(): Integration[] {
  return useSession.getState().vault?.settings.integrations ?? [];
}

export function integrationById(id: string): Integration | undefined {
  return integrations().find((i) => i.id === id);
}

export const KIND_LABEL: Record<IntegrationKind, string> = { api_key: "API-Schlüssel", webhook: "Webhook", sap_b1: "SAP Business One", rest_pull: "REST-Abruf" };

/** A new connection with sensible defaults; API keys and webhook secrets are generated here, never typed. */
export function draftIntegration(kind: IntegrationKind, patch: Partial<Integration> = {}): Integration {
  const store = requireStore();
  const now = nowIso();
  return IntegrationSchema.parse({
    id: `int_${crypto.randomUUID().slice(0, 8)}`,
    kind,
    name: patch.name ?? KIND_LABEL[kind],
    profileId: store.activeProfile.id,
    secret: kind === "api_key" ? randomSecret("ordo_") : kind === "webhook" ? randomSecret("whsec_") : "",
    scopes: kind === "api_key" ? ["contacts:read", "transactions:read", "invoices:read"] : [],
    events: kind === "webhook" ? ["invoice", "transaction"] : [],
    targets: kind === "sap_b1" ? ["contacts"] : [],
    // a webhook starts with what changes from now on – not with the whole history
    cursor: kind === "webhook" ? now : undefined,
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
}

export function saveIntegration(next: Integration): Integration {
  const parsed = IntegrationSchema.parse({ ...next, updatedAt: nowIso() });
  requireStore().mutate((v) => {
    const list = v.settings.integrations ?? [];
    const exists = list.some((i) => i.id === parsed.id);
    v.settings = { ...v.settings, integrations: exists ? list.map((i) => (i.id === parsed.id ? parsed : i)) : [...list, parsed] };
  });
  return parsed;
}

export function removeIntegration(id: string): void {
  requireStore().mutate((v) => {
    v.settings = { ...v.settings, integrations: (v.settings.integrations ?? []).filter((i) => i.id !== id) };
  });
}

/** Records the outcome of a run (plain words only, never data values or secrets). */
export function logRun(id: string, ok: boolean, message: string, patch: Partial<Integration> = {}): void {
  const store = useSession.getState().store;
  if (!store) return;
  store.mutate((v) => {
    v.settings = { ...v.settings, integrations: (v.settings.integrations ?? []).map((i) => (i.id === id ? { ...withLog(i, ok, message, nowIso()), ...patch } : i)) };
  });
}
