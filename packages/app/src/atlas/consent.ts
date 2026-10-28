import { can, type VaultStore } from "@ordo/core";
import { create } from "zustand";
import { useSession } from "@/state/session";

interface ConsentRequest {
  id: number;
  store: VaultStore;
  provider: "claude" | "openai" | "codex";
  resolve: (accepted: boolean) => void;
}

export const useAtlasConsent = create<{ request: ConsentRequest | null }>(() => ({ request: null }));
let requestId = 0;

export function mayConsentToAtlas(store: VaultStore): boolean {
  const v = store.vault;
  const member = v.members.find((m) => m.id === v.settings.meMemberId && !m.deletedAt);
  return can(member?.role ?? "owner", "settings", "write");
}

export function closeAtlasConsent() {
  const request = useAtlasConsent.getState().request;
  useAtlasConsent.setState({ request: null });
  request?.resolve(false);
}

/** Asking never grants permission. Only the explicit confirmation below changes the vault. */
export function requestAtlasConsent(): Promise<boolean> {
  closeAtlasConsent();
  const store = useSession.getState().store;
  if (!store || !mayConsentToAtlas(store)) return Promise.resolve(false);
  const { provider, consent } = store.vault.settings.atlas;
  if (provider === "none") return Promise.resolve(false);
  if (consent) return Promise.resolve(true);
  return new Promise((resolve) => useAtlasConsent.setState({ request: { id: ++requestId, store, provider, resolve } }));
}

export function confirmAtlasConsent(): void {
  const request = useAtlasConsent.getState().request;
  if (!request) return;
  const store = useSession.getState().store;
  if (store !== request.store || store.vault.settings.atlas.provider !== request.provider || !mayConsentToAtlas(store)) {
    closeAtlasConsent();
    return;
  }
  store.mutate((v) => { v.settings = { ...v.settings, atlas: { ...v.settings.atlas, consent: true } }; });
  useAtlasConsent.setState({ request: null });
  request.resolve(true);
}

// A dialog opened for one vault/provider must never approve a different context.
useSession.subscribe((session) => {
  const request = useAtlasConsent.getState().request;
  if (request && (session.store !== request.store || session.vault?.settings.atlas.provider !== request.provider || !mayConsentToAtlas(request.store))) closeAtlasConsent();
});
