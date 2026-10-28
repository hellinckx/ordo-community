import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { useSession } from "@/state/session";
import { toast } from "@/state/toasts";
import { useProfile } from "@/state/hooks";
import { isTauri } from "@/platform";
import { readiness, sendMessage, useAtlasRuns, type Readiness, type RunState } from "./engine";
import { mayConsentToAtlas, requestAtlasConsent } from "./consent";

/** Reactive version of `readiness()` – what is missing before Atlas can answer. */
export function useAtlasReadiness(): Readiness {
  const settings = useSession((s) => s.vault?.settings);
  const platform = useSession((s) => s.platform);
  return useMemo<Readiness>(() => {
    if (!settings) return { ok: false, reason: "locked", message: "Der Tresor ist gesperrt." };
    const a = settings.atlas;
    if (a.provider === "none") return { ok: false, reason: "off", message: "Atlas ist noch nicht eingerichtet. Wähl einen KI-Anbieter – Claude oder OpenAI mit API-Key oder, in der Desktop-App, ChatGPT über Codex." };
    if (a.provider === "codex" && (!isTauri || !platform?.codex?.chat)) return { ok: false, reason: "desktop", message: "ChatGPT über Codex gibt es nur in der Desktop-App. Im Browser geht Atlas mit einem API-Key von Claude oder OpenAI." };
    if (a.provider === "claude" && !settings.ai.anthropicApiKey.trim()) return { ok: false, reason: "key", message: "Für Claude fehlt noch der API-Key von console.anthropic.com." };
    if (a.provider === "openai" && !settings.ai.openaiApiKey.trim()) return { ok: false, reason: "key", message: "Für OpenAI fehlt noch der API-Key von platform.openai.com." };
    if (!a.consent) return { ok: false, reason: "consent", message: "Atlas braucht deine Einwilligung, die für eine Antwort nötigen Daten an den KI-Anbieter zu senden." };
    return { ok: true, provider: a.provider };
  }, [settings, platform]);
}

/** Hands a job to Atlas and opens the chat – or the setup when no AI is connected yet. */
export function useAskAtlas() {
  const navigate = useNavigate();
  return useCallback(
    async (text: string) => {
      let r = readiness();
      if (!r.ok && r.reason === "consent") {
        const store = useSession.getState().store;
        if (store && !mayConsentToAtlas(store)) {
          toast.info("Einwilligung für Atlas erforderlich", "Bitte Inhaber:in oder Administration, die Datenübertragung für diesen Tresor zu erlauben.");
          return;
        }
        if (!await requestAtlasConsent()) return;
        r = readiness();
      }
      if (!r.ok) {
        toast.info("Zuerst KI verbinden", r.message);
        navigate("/einstellungen/atlas");
        return;
      }
      const id = await sendMessage(undefined, text);
      navigate(`/atlas/${id}`);
    },
    [navigate],
  );
}

export function useAtlasRun(chatId: string | undefined): RunState | undefined {
  return useAtlasRuns((s) => (chatId ? s.runs[chatId] : undefined));
}

/** Chats of the active profile: pinned first, then newest first. */
export function useAtlasChats() {
  const chats = useSession((s) => s.vault?.atlasChats);
  const profile = useProfile();
  return useMemo(
    () =>
      (chats ?? [])
        .filter((c) => !c.deletedAt && (!c.profileId || c.profileId === profile.id))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
    [chats, profile.id],
  );
}
