import { ids, newId, nowIso, type Contact, type ContactPerson, type Folder, type Member, type VaultStore } from "@ordo/core";
import { nextContactNumber } from "./contactNumber";
import { ensureFolderFor, ensureSystemFolders } from "./files/fileStore";

const person = (firstName: string, lastName: string, role: string, email: string, phone = ""): ContactPerson => ({ id: newId("cps"), firstName, lastName, role, email, phone, notes: "" });

/** Demo content for Ordo Basis: a small team, contact persons and numbers on the demo customers, a few folders. */
export function seedBasisDemo(store: VaultStore, profileId: string): void {
  const now = nowIso();
  const mk = (p: Partial<Member> & Pick<Member, "name" | "role">): Member => ({ id: ids.member(), email: "", title: "", hourlyCostCents: 0, hourlyRateCents: 0, weeklyHours: 38.5, color: "#0a5fe0", active: true, phone: "", notes: "", createdAt: now, updatedAt: now, ...p });
  const max = mk({ name: "Max Muster", role: "owner", title: "Geschäftsführung", email: "max@musterdesign.at", phone: "+43 660 1234567", hourlyCostCents: 4800, hourlyRateCents: 9500, weeklyHours: 40, color: "#0a5fe0" });
  const lena = mk({ name: "Lena Huber", role: "manager", title: "Projektleitung", email: "lena@musterdesign.at", phone: "+43 664 2345678", hourlyCostCents: 4200, hourlyRateCents: 8500, weeklyHours: 38.5, color: "#5856d6" });
  const tobias = mk({ name: "Tobias Gruber", role: "member", title: "Grafik & Produktion", email: "tobias@musterdesign.at", hourlyCostCents: 3100, hourlyRateCents: 6800, weeklyHours: 38.5, color: "#0f9d8a" });

  const extras: Record<string, Partial<Contact>> = {
    "Alpenblick Hotel GmbH": {
      persons: [person("Andrea", "Steiner", "Geschäftsführung", "a.steiner@alpenblick.at", "+43 6542 12345"), person("Florian", "Wimmer", "Marketing", "marketing@alpenblick.at")],
      website: "alpenblick.at",
      paymentDueDays: 14,
      paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    },
    "Stadtwerke Linz GmbH": {
      persons: [person("Karin", "Lehner", "Einkauf", "k.lehner@stadtwerke-linz.at", "+43 732 3400"), person("Michael", "Brandstätter", "Kommunikation", "m.brandstaetter@stadtwerke-linz.at")],
      paymentDueDays: 30,
      paymentTerms: "Zahlbar innerhalb von 30 Tagen netto.",
    },
    "Café Morgenrot": {
      persons: [person("Sophie", "Berger", "Inhaberin", "hallo@cafe-morgenrot.at", "+43 676 9876543")],
      paymentDueDays: 7,
    },
  };

  store.mutate(
    (v) => {
      v.members = [...v.members, max, lena, tobias];
      v.settings = { ...v.settings, meMemberId: max.id };
      // K-numbers: customers first, then suppliers, each alphabetically
      const order = v.contacts
        .filter((c) => c.profileId === profileId && !c.deletedAt && !c.number)
        .sort((a, b) => Number(a.kind === "vendor") - Number(b.kind === "vendor") || a.name.localeCompare(b.name, "de"));
      const numbered = new Map<string, string>();
      const taken = v.contacts.filter((c) => c.profileId === profileId);
      for (const c of order) {
        const n = nextContactNumber([...taken, ...[...numbered.values()].map((number) => ({ number }))]);
        numbered.set(c.id, n);
      }
      v.contacts = v.contacts.map((c) => {
        const n = numbered.get(c.id);
        const x = c.profileId === profileId ? extras[c.name] : undefined;
        return n || x ? { ...c, ...(x ?? {}), number: c.number ?? n, updatedAt: now } : c;
      });
    },
    { audit: { action: "demo.seed", entity: "members" } },
  );

  // folders: Kunden / Projekte / Allgemein, a folder per demo customer, two everyday folders
  const roots = ensureSystemFolders(store, profileId);
  for (const c of store.vault.contacts.filter((x) => x.profileId === profileId && !x.deletedAt && extras[x.name])) ensureFolderFor(store, profileId, { type: "contact", id: c.id });
  const extra: Folder[] = ["Verträge", "Vorlagen"].map((name) => ({ id: ids.folder(), profileId, parentId: roots.allgemein, name, system: false, createdAt: now, updatedAt: now }));
  store.mutate((v) => {
    v.folders = [...v.folders, ...extra];
  });
}
