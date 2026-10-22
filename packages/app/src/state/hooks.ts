import { useMemo } from "react";
import type { Category, Contact, EntityCollection, EntityOf, Profile, Settings, Vault } from "@ordo/core";
import { requireStore, useSession } from "./session";

export function useVault(): Vault {
  const vault = useSession((s) => s.vault);
  if (!vault) throw new Error("Tresor nicht geöffnet.");
  return vault;
}

export function useProfile(): Profile {
  const vault = useVault();
  return useMemo(() => {
    const p = vault.profiles.find((x) => x.id === vault.activeProfileId && !x.deletedAt) ?? vault.profiles.find((x) => !x.deletedAt);
    if (!p) throw new Error("Kein Profil.");
    return p;
  }, [vault.profiles, vault.activeProfileId]);
}

export function useSettings(): Settings {
  return useVault().settings;
}

/** Non-deleted entities of the active profile (or all for profile-less collections). */
export function useList<C extends EntityCollection>(collection: C, opts: { all?: boolean } = {}): EntityOf<C>[] {
  const vault = useVault();
  const profile = useProfile();
  const rows = vault[collection] as unknown as EntityOf<C>[];
  return useMemo(() => {
    return rows.filter((e) => {
      const any = e as unknown as { deletedAt?: string; profileId?: string };
      if (any.deletedAt) return false;
      if (!opts.all && "profileId" in any && any.profileId !== profile.id) return false;
      return true;
    });
  }, [rows, profile.id, opts.all]);
}

export function useCategories(kind?: "income" | "expense"): Category[] {
  const vault = useVault();
  const profile = useProfile();
  return useMemo(
    () =>
      vault.categories
        .filter((c) => !c.deletedAt && !c.isArchived && (c.mode === "both" || c.mode === profile.mode) && (!kind || c.kind === kind))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "de")),
    [vault.categories, profile.mode, kind],
  );
}

/** Settings live inside the vault; every change is persisted and synced like any other entity. */
export function useSettingsMutator() {
  return (fn: (s: Settings) => Settings) => requireStore().mutate((v) => { v.settings = fn(v.settings); });
}

export function useCategoryMap(): Map<string, Category> {
  const vault = useVault();
  return useMemo(() => new Map(vault.categories.map((c) => [c.id, c])), [vault.categories]);
}

export function useContacts(): Contact[] {
  const list = useList("contacts");
  return useMemo(() => [...list].sort((a, b) => a.name.localeCompare(b.name, "de")), [list]);
}

export function useContactMap(): Map<string, Contact> {
  const vault = useVault();
  return useMemo(() => new Map(vault.contacts.map((c) => [c.id, c])), [vault.contacts]);
}
