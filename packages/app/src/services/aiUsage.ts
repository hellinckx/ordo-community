/**
 * Records what each AI call cost (tokens, estimated list price) into the vault's monthly statistics and warns once a
 * month when the person's own limit is passed. Only numbers – never prompts, answers or document content.
 */
import { addAiUsage, aiUsageByMonth, type AiCall } from "@ordo/core";
import { useSession } from "@/state/session";
import { toast } from "@/state/toasts";

const usd = (cents: number) => (cents / 100).toLocaleString("de-AT", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function recordAiUsage(call: AiCall): void {
  const store = useSession.getState().store;
  if (!store) return;
  let warn: { spent: number; limit: number } | null = null;
  store.mutate((v) => {
    const usage = addAiUsage(v.settings.aiUsage, call);
    const month = new Date().toISOString().slice(0, 7);
    const spent = aiUsageByMonth(usage, 1)[0]?.costCents ?? 0;
    const limit = usage.monthlyLimitCents;
    if (limit > 0 && spent > limit && usage.warnedMonth !== month) {
      warn = { spent, limit };
      usage.warnedMonth = month;
    }
    v.settings = { ...v.settings, aiUsage: usage };
  });
  if (warn) {
    const w = warn as { spent: number; limit: number };
    toast.warning("KI-Limit für diesen Monat überschritten", `Geschätzt ${usd(w.spent)} von ${usd(w.limit)}. Details und Limit unter Einstellungen → KI-Verbrauch.`);
  }
}
