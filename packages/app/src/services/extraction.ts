import {
  TextExtractor,
  createTesseractOcr,
  createOpenAiProvider,
  createAnthropicProvider,
  createOllamaProvider,
  createCodexProvider,
  CLAUDE_AUTO_MODEL,
  ProviderError,
  type ExtractionProvider,
  type ProviderErrorCode,
  type Settings,
} from "@ordo/core";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Platform } from "@/platform";

let extractor: TextExtractor | null = null;
let ocr: ReturnType<typeof createTesseractOcr> | null = null;

export function getTextExtractor(settings: Settings): TextExtractor {
  if (!ocr) {
    ocr = createTesseractOcr({
      languages: settings.ocrLanguages.length ? settings.ocrLanguages : ["deu", "eng"],
      workerPath: `${import.meta.env.BASE_URL}tesseract/worker.min.js`,
      corePath: `${import.meta.env.BASE_URL}tesseract`,
      langPath: `${import.meta.env.BASE_URL}tessdata`,
    });
  }
  if (!extractor) {
    extractor = new TextExtractor({ pdfWorkerSrc: pdfWorkerUrl, ocr, maxPages: 3, renderScale: 1.6 });
  }
  return extractor;
}

export function createProvider(settings: Settings, platform: Platform): ExtractionProvider | undefined {
  const ai = settings.ai;
  switch (ai.provider) {
    case "codex":
      return platform.codex ? createCodexProvider(platform.codex, { model: ai.codexModel, reasoning: ai.codexReasoning }) : undefined;
    case "openai":
      return createOpenAiProvider({ apiKey: ai.openaiApiKey, model: ai.openaiModel });
    case "anthropic":
      return createAnthropicProvider({ apiKey: ai.anthropicApiKey.trim(), model: ai.anthropicModel.trim() || CLAUDE_AUTO_MODEL, escalateBelow: ai.minAutoApproveConfidence });
    case "ollama":
      return createOllamaProvider({ url: ai.ollamaUrl, model: ai.ollamaModel });
    default:
      return undefined;
  }
}

export const PROVIDER_LABELS: Record<Settings["ai"]["provider"], { name: string; desc: string; cloud: boolean; desktopOnly?: boolean }> = {
  none: { name: "Ohne KI (nur lokale Erkennung)", desc: "OCR + Regel-Parser. Funktioniert offline, Daten verlassen nie das Gerät. Trefferquote bei Standardbelegen gut, bei Fotos mittel.", cloud: false },
  codex: { name: "ChatGPT / Codex (mit ChatGPT-Konto anmelden)", desc: "Nutzt dein ChatGPT-Abo über die lokale Codex-CLI – kein API-Key nötig. Rechnungsbilder werden an OpenAI gesendet.", cloud: true, desktopOnly: true },
  openai: { name: "OpenAI API (API-Key)", desc: "Direkt gegen die OpenAI-API mit eigenem Key. Funktioniert auch am Handy/PWA.", cloud: true },
  anthropic: { name: "Anthropic Claude (API-Key)", desc: "Claude liest das Rechnungsbild selbst. Standard: automatisch das günstigste Modell (Haiku), bei Unsicherheit liest Opus nach. Derselbe Key wie für Atlas.", cloud: true },
  ollama: { name: "Ollama (lokales Modell)", desc: "Vollständig offline mit einem lokalen Vision-Modell (z. B. qwen3-vl). Benötigt Ollama auf diesem Rechner.", cloud: false },
};

/** The Claude model setting before "Automatisch" existed – safe to switch when Claude starts reading invoices. */
const LEGACY_DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/** Claude is connected (e.g. for Atlas) but does not read invoices yet. */
export function canOfferClaudeForInvoices(settings: Settings): boolean {
  return settings.ai.provider === "none" && !!settings.ai.anthropicApiKey.trim();
}

/** Settings patch for "Claude auch zum Lesen von Rechnungen verwenden" (consent is given in the same dialog). */
export function claudeForInvoicesPatch(ai: Settings["ai"]): Partial<Settings["ai"]> {
  const model = ai.anthropicModel.trim();
  return { provider: "anthropic", cloudConsent: true, anthropicModel: !model || model === LEGACY_DEFAULT_CLAUDE_MODEL ? CLAUDE_AUTO_MODEL : model };
}

export type AiReadiness = { ok: true } | { ok: false; code: ProviderErrorCode | "offer_claude"; message: string };

/** Can "Mit KI lesen" run right now? Plain-German reason if not. */
export function aiReadiness(settings: Settings, platform: Platform | null): AiReadiness {
  const ai = settings.ai;
  if (ai.provider === "none") {
    if (ai.anthropicApiKey.trim()) return { ok: false, code: "offer_claude", message: "Claude ist mit deinem API-Key verbunden, liest aber noch keine Rechnungen." };
    return { ok: false, code: "no_provider", message: "Es ist noch keine KI zum Lesen eingerichtet. Wähl unter Einstellungen → KI-Erkennung einen Anbieter." };
  }
  if (ai.provider === "anthropic" && !ai.anthropicApiKey.trim()) return { ok: false, code: "no_key", message: "Für Claude fehlt der API-Key. Trag ihn unter Einstellungen → KI-Erkennung ein." };
  if (ai.provider === "openai" && !ai.openaiApiKey.trim()) return { ok: false, code: "no_key", message: "Für OpenAI fehlt der API-Key. Trag ihn unter Einstellungen → KI-Erkennung ein." };
  if (ai.provider === "codex" && !platform?.codex) return { ok: false, code: "no_provider", message: "Die Anmeldung mit ChatGPT geht nur in der Windows-App. Im Browser bitte einen API-Key verwenden." };
  if (PROVIDER_LABELS[ai.provider].cloud && !ai.cloudConsent) return { ok: false, code: "consent", message: "Du hast noch nicht erlaubt, Rechnungen zum Lesen an den KI-Anbieter zu senden (Einstellungen → KI-Erkennung)." };
  return { ok: true };
}

/** Error code of a failed AI read (network errors of other providers included). */
export function aiErrorCode(e: unknown): ProviderErrorCode {
  if (e instanceof ProviderError) return e.code;
  if (e instanceof DOMException && e.name === "AbortError") return "aborted";
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return "network";
  return "other";
}

/** Plain-German message for a failed AI read. */
export function aiErrorMessage(e: unknown): string {
  const code = aiErrorCode(e);
  if (code === "network" && !(e instanceof ProviderError)) return "Keine Verbindung zum KI-Anbieter. Bist du online?";
  if (code === "aborted") return "Abgebrochen.";
  return e instanceof Error ? e.message : String(e);
}
