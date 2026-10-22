/**
 * What a sync account may store: plan name, storage and device limits. The operator of a server sets them in
 * summa_settings.plans; without settings these defaults apply.
 */
import { planLimitMb, type PlanDef, type PlanId, type ServerSettings } from "@/services/sync";

export interface Entitlements {
  plan: PlanId;
  label: string;
  storageMb: number;
  devices: number;
  priceEur: number;
}

const FALLBACK: Record<PlanId, PlanDef> = {
  free: { label: "Free", storage_mb: 50, devices: 3, price_eur: 0 },
  pro: { label: "Pro", storage_mb: 500, devices: 10, price_eur: 4.9 },
  family: { label: "Family", storage_mb: 1000, devices: 20, price_eur: 7.9 },
};

export function planDef(plan: PlanId, settings: ServerSettings): PlanDef {
  return settings.plans?.[plan] ?? FALLBACK[plan];
}

export function entitlements(plan: PlanId, settings: ServerSettings): Entitlements {
  const d = planDef(plan, settings);
  return { plan, label: d.label, storageMb: planLimitMb(plan, settings), devices: d.devices, priceEur: d.price_eur };
}
