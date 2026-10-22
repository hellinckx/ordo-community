import type { AtlasSettings } from "@ordo/core";
import { DEFAULT_CLAUDE_MODEL, claudeModelLabel } from "./providers/claude";
import type { Effort } from "./providers/types";

export interface Route {
  provider: "claude" | "codex";
  model: string;
  effort: Effort;
  /** For the badge, e.g. "Opus 5.5 · gründlich". */
  label: string;
  auto: boolean;
}

// (?<!\p{L}) = word start that also works for umlauts (\b does not)
const WRITE = /(?<!\p{L})(erfass\p{L}*|leg(e|t)?|anleg\p{L}*|buch(e|en|t)|verbuch\p{L}*|erstell\p{L}*|änder\p{L}*|aender\p{L}*|setz(e|t|en)?|verschieb\p{L}*|lösch\p{L}*|loesch\p{L}*|start(e|en)?|stopp\p{L}*|trag(e|t)?|eintrag\p{L}*|markier\p{L}*|schließ\p{L}*|schliess\p{L}*|zuweis\p{L}*|weis(e|t))(?!\p{L})/iu;
const ANALYSIS = /(?<!\p{L})(analys|auswert|vergleich|warum|wieso|trend|entwickl|prognos|quartal|gewinn|marge|rentab|diagramm|grafik|chart|pro kunde|je kunde|pro monat|je monat|top ?\d|ranking|zusammenfass|bericht|überblick|ueberblick|wie lief|wie läuft|steuer|uva|e1a|l1)/iu;
const LOOKUP = /^(wie ?viel|wann|wer|wo|welche[rsmn]?|was|zeig|liste|gibt es|hab ich|habe ich|ist|sind|offen|überfällig)/iu;
const MORE = /(?<!\p{L})(und dann|danach|außerdem|ausserdem|alle|jede[nrs]?)(?!\p{L})/iu;

/**
 * Auto: Opus 5.5 with the effort picked per request – low for quick lookups and short questions, high for changes
 * with several steps and for analyses, medium otherwise. Effort is fixed for one whole turn (all tool steps), so the
 * cached prefix is reused within the turn.
 */
export function pickEffort(text: string): Effort {
  const t = text.trim();
  const writes = (t.match(new RegExp(WRITE.source, "giu")) ?? []).length;
  const multiStep = writes >= 2 || (writes >= 1 && (t.length > 160 || MORE.test(t)));
  if (multiStep || ANALYSIS.test(t) || t.length > 320) return "high";
  if (!writes && t.length <= 90 && (LOOKUP.test(t) || t.endsWith("?"))) return "low";
  return "medium";
}

export const EFFORT_LABEL: Record<Effort, string> = { low: "schnell", medium: "normal", high: "gründlich" };

export function route(settings: AtlasSettings, userText: string, codexDefault?: string): Route {
  if (settings.provider === "codex") {
    const effort = settings.model === "auto" ? pickEffort(userText) : "medium";
    const model = settings.codexModel.trim();
    return { provider: "codex", model, effort, label: `${model || codexDefault || "ChatGPT"} · ${EFFORT_LABEL[effort]}`, auto: settings.model === "auto" };
  }
  if (settings.model === "auto" || !settings.model.startsWith("claude-")) {
    const effort = pickEffort(userText);
    return { provider: "claude", model: DEFAULT_CLAUDE_MODEL, effort, label: `Auto · ${claudeModelLabel(DEFAULT_CLAUDE_MODEL)} · ${EFFORT_LABEL[effort]}`, auto: true };
  }
  return { provider: "claude", model: settings.model, effort: "medium", label: `${claudeModelLabel(settings.model)} · ${EFFORT_LABEL.medium}`, auto: false };
}

/** Room for adaptive thinking plus the answer. */
export function maxTokensFor(effort: Effort): number {
  return effort === "high" ? 32_000 : 16_000;
}
