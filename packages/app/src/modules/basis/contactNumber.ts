import type { Contact, Vault } from "@ordo/core";

/** Next free customer/supplier number like "K-0012" (highest existing K-number + 1, deleted ones included). */
export function nextContactNumber(contacts: Pick<Contact, "number">[]): string {
  let max = 0;
  for (const c of contacts) {
    const m = /^K-?(\d+)$/i.exec(c.number?.trim() ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `K-${String(max + 1).padStart(4, "0")}`;
}

/** Next K-number within one profile of the vault. */
export function nextContactNumberFor(vault: Vault, profileId: string): string {
  return nextContactNumber(vault.contacts.filter((c) => c.profileId === profileId));
}
