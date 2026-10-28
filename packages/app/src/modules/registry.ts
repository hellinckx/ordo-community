import { useMemo } from "react";
import { nowIso, type Member, type Role, type Settings } from "@ordo/core";
import { requireStore, useSession } from "@/state/session";
import { useSync } from "@/services/sync";
import { basisModule } from "./basis";
import { summaModule } from "./summa";
import { projekteModule } from "./projekte";
import { produkteModule } from "./produkte";
import { produktionModule } from "./produktion";
import { postModule } from "./post";
import type { ModuleId, OrdoModule } from "./types";

/** Order = order in the sidebar and in the module overview. */
export const ALL_MODULES: OrdoModule[] = [basisModule, projekteModule, summaModule, produkteModule, produktionModule, postModule];

export function moduleById(id: string): OrdoModule | undefined {
  return ALL_MODULES.find((m) => m.id === id);
}

export function isInstalled(settings: Settings | undefined, m: OrdoModule): boolean {
  if (m.required) return true;
  return settings?.modules[m.id]?.installed ?? m.defaultInstalled;
}

/** Whether the operator allows this account to use the module (admin-controlled; everything allowed offline). */
export function isAllowed(access: Record<string, boolean> | null, id: ModuleId): boolean {
  if (id === "basis") return true;
  return access?.[id] ?? true;
}

export function useModuleAccess(): Record<string, boolean> | null {
  return useSync((s) => s.moduleAccess);
}

/** Installed and allowed modules, in sidebar order. */
export function useInstalledModules(): OrdoModule[] {
  const settings = useSession((s) => s.vault?.settings);
  const access = useModuleAccess();
  return useMemo(() => ALL_MODULES.filter((m) => isInstalled(settings, m) && isAllowed(access, m.id)), [settings, access]);
}

export function useIsInstalled(id: ModuleId): boolean {
  return useInstalledModules().some((m) => m.id === id);
}

export function installModule(id: ModuleId): void {
  const m = moduleById(id);
  if (!m) return;
  const ids = [...(m.requires ?? []), id];
  requireStore().mutate((v) => {
    const modules = { ...v.settings.modules };
    for (const x of ids) modules[x] = { installed: true, installedAt: modules[x]?.installedAt ?? nowIso() };
    v.settings = { ...v.settings, modules };
  });
}

/** Removes a module from the menu. Its data stays in the vault and comes back on re-install. */
export function uninstallModule(id: ModuleId): void {
  const m = moduleById(id);
  if (!m || m.required) return;
  const dependents = ALL_MODULES.filter((x) => x.requires?.includes(id)).map((x) => x.id);
  requireStore().mutate((v) => {
    const modules = { ...v.settings.modules };
    for (const x of [id, ...dependents]) modules[x] = { installed: false, installedAt: modules[x]?.installedAt };
    v.settings = { ...v.settings, modules };
  });
}

/** The person using this device and their role. Without a team, the user is the owner. */
export function useMe(): { member?: Member; role: Role } {
  const vault = useSession((s) => s.vault);
  return useMemo(() => {
    const member = vault?.members.find((m) => m.id === vault.settings.meMemberId && !m.deletedAt);
    return { member, role: member?.role ?? "owner" };
  }, [vault?.members, vault?.settings.meMemberId]);
}
