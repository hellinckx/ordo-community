import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage";
import { VaultStore } from "./store";
import { WrongPasswordError, deriveAccountSecret, generateRecoveryKey, normalizeRecoveryKey } from "./crypto";
import { occurrences, materialize } from "../recurring/recurring";
import type { RecurringRule } from "../model/types";

describe("VaultStore", () => {
  it("creates, saves, reopens and rejects wrong passwords", async () => {
    const storage = new MemoryStorage();
    const { store, recoveryKey } = await VaultStore.create(storage, { password: "korrekt-pferd-batterie", profileName: "Ich", mode: "employee" });
    expect(recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
    expect(store.vault.profiles).toHaveLength(1);
    expect(store.vault.categories.length).toBeGreaterThan(40);
    store.insert("contacts", { id: "c1", profileId: store.activeProfile.id, name: "Billa", kind: "vendor", uid: "", email: "", phone: "", street: "", zip: "", city: "", country: "AT", iban: "", notes: "", aliases: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const att = await store.putAttachment(store.activeProfile.id, new TextEncoder().encode("hello"), { name: "a.txt", mime: "text/plain" });
    await store.flush();
    expect(store.vault.revision).toBeGreaterThan(0);

    await expect(VaultStore.open(storage, { password: "falsch" })).rejects.toBeInstanceOf(WrongPasswordError);
    const reopened = await VaultStore.open(storage, { password: "korrekt-pferd-batterie" });
    expect(reopened.list("contacts")).toHaveLength(1);
    expect(new TextDecoder().decode((await reopened.getAttachmentBytes(att.id))!)).toBe("hello");

    const viaRecovery = await VaultStore.open(storage, { recoveryKey: recoveryKey!.toLowerCase().replace(/-/g, " ") });
    expect(viaRecovery.list("contacts")).toHaveLength(1);

    await reopened.changePassword("korrekt-pferd-batterie", "neues-passwort");
    await expect(VaultStore.open(storage, { password: "korrekt-pferd-batterie" })).rejects.toBeInstanceOf(WrongPasswordError);
    const again = await VaultStore.open(storage, { password: "neues-passwort" });
    expect(again.activeProfile.name).toBe("Ich");

    // forgotten password: recovery key opens the vault, a new password replaces the old one
    const recovered = await VaultStore.open(storage, { recoveryKey: recoveryKey! });
    await recovered.resetPassword("ganz-neues-passwort");
    await expect(VaultStore.open(storage, { password: "neues-passwort" })).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await VaultStore.open(storage, { password: "ganz-neues-passwort" })).list("contacts")).toHaveLength(1);
    expect((await VaultStore.open(storage, { recoveryKey: recoveryKey! })).list("contacts")).toHaveLength(1);
  }, 60000);

  it("normalizes recovery keys", () => {
    const k = generateRecoveryKey();
    expect(normalizeRecoveryKey(k.toLowerCase())).toBe(k.replace(/-/g, ""));
    expect(normalizeRecoveryKey("O1IL")).toBe("0111");
  });
});

describe("recurring", () => {
  const rule: RecurringRule = {
    id: "r1", profileId: "p1", name: "Miete", active: true, interval: "monthly", dayOfMonth: 31, startDate: "2026-01-31", autoBook: true, createdAt: "", updatedAt: "",
    template: { kind: "expense", description: "Miete", vatLines: [], grossCents: 90000, vatTreatment: "standard", vatDeductiblePct: 100, paymentMethod: "bank", tags: [] },
  };
  it("clamps day of month and respects lastMaterializedDate", () => {
    expect(occurrences(rule, "2026-04-15")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(occurrences({ ...rule, lastMaterializedDate: "2026-02-28" }, "2026-04-15")).toEqual(["2026-03-31"]);
    expect(occurrences({ ...rule, interval: "quarterly" }, "2026-12-31")).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
    const t = materialize(rule, "2026-03-31");
    expect(t).toMatchObject({ kind: "expense", grossCents: 90000, date: "2026-03-31", recurringRuleId: "r1", origin: "recurring" });
  });
});

describe("deriveAccountSecret", () => {
  it("is deterministic per e-mail, case-insensitive, and never the password", async () => {
    const a = await deriveAccountSecret("Office@Muster.at ", "korrekt-pferd-batterie");
    const b = await deriveAccountSecret("office@muster.at", "korrekt-pferd-batterie");
    const c = await deriveAccountSecret("other@example.at", "korrekt-pferd-batterie");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("pferd");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
