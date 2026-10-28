import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault, VaultStore } from "@ordo/core";

vi.mock("@/state/session", async () => {
  const { create } = await import("zustand");
  return { useSession: create(() => ({ store: null as VaultStore | null, vault: null as Vault | null })) };
});
import { useSession } from "@/state/session";
import { closeAtlasConsent, confirmAtlasConsent, requestAtlasConsent, useAtlasConsent } from "./consent";

let store: VaultStore;
const mutate = vi.fn();
beforeEach(() => {
  const vault = { members: [], settings: { meMemberId: "", atlas: { provider: "claude", consent: false, instructions: "Behalte diese Anweisung", permission: "confirm" } } } as unknown as Vault;
  mutate.mockReset().mockImplementation((change: (v: Vault) => void) => {
    change(vault);
    useSession.setState({ vault: { ...vault } });
  });
  store = { vault, mutate } as unknown as VaultStore;
  useSession.setState({ store, vault });
});
afterEach(closeAtlasConsent);

describe("Atlas consent requested in place", () => {
  it("does not enable data transfer when the dialog is opened or cancelled", async () => {
    const result = requestAtlasConsent();
    expect(useAtlasConsent.getState().request?.provider).toBe("claude");
    expect(store.vault.settings.atlas.consent).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    closeAtlasConsent();
    await expect(result).resolves.toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("grants only after confirmation and resumes a waiting action once", async () => {
    const resume = vi.fn();
    const result = requestAtlasConsent().then((accepted) => { if (accepted) resume(); });
    expect(resume).not.toHaveBeenCalled();
    confirmAtlasConsent();
    confirmAtlasConsent();
    await result;
    expect(resume).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(store.vault.settings.atlas).toMatchObject({ consent: true, instructions: "Behalte diese Anweisung", permission: "confirm" });
    expect(useAtlasConsent.getState().request).toBeNull();
  });
  it("does not open another dialog when consent was already given", async () => {
    store.vault.settings.atlas.consent = true;
    await expect(requestAtlasConsent()).resolves.toBe(true);
    expect(useAtlasConsent.getState().request).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("does not permit a team member to change administrator settings", async () => {
    store.vault.settings.meMemberId = "member";
    store.vault.members = [{ id: "member", role: "member" }] as Vault["members"];
    await expect(requestAtlasConsent()).resolves.toBe(false);
    confirmAtlasConsent();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("cancels pending consent on locking or switching vaults", async () => {
    const result = requestAtlasConsent();
    useSession.setState({ store: null, vault: null });
    confirmAtlasConsent();
    await expect(result).resolves.toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("does not approve a different provider than the one explained", async () => {
    const result = requestAtlasConsent();
    store.vault.settings.atlas.provider = "openai";
    confirmAtlasConsent();
    await expect(result).resolves.toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("rechecks the role when confirming", async () => {
    const result = requestAtlasConsent();
    store.vault.settings.meMemberId = "viewer";
    store.vault.members = [{ id: "viewer", role: "viewer" }] as Vault["members"];
    confirmAtlasConsent();
    await expect(result).resolves.toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("cancels superseded actions and starts with a fresh dialog identity", async () => {
    const first = requestAtlasConsent();
    const id = useAtlasConsent.getState().request?.id;
    const second = requestAtlasConsent();
    await expect(first).resolves.toBe(false);
    expect(useAtlasConsent.getState().request?.id).not.toBe(id);
    confirmAtlasConsent();
    await expect(second).resolves.toBe(true);
  });
  it("requires a configured provider", async () => {
    store.vault.settings.atlas.provider = "none";
    await expect(requestAtlasConsent()).resolves.toBe(false);
    expect(useAtlasConsent.getState().request).toBeNull();
  });
});
