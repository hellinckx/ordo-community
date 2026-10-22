import { beforeAll, describe, expect, it } from "vitest";
import { IntegrationSchema, MemoryStorage, VaultStore, nowIso, seedDemoVault, type Integration } from "@ordo/core";
import { useSession } from "@/state/session";
import type { OrdoModule } from "@/modules/types";
import { buildToolset, runTool, toolContext } from "@/atlas/toolset";
import { connectionCode, isOrdoServer, keyProblem, normalizeServerUrl, parseConnectionCode, usagePeak, ORDO_SERVER, type ProjectUsage } from "@/services/server";
import { pendingEvents } from "./webhooks";
import { createTransaction, upsertContact } from "./apply";
import { serviceLayerBase } from "./sapB1";

const mod = (id: OrdoModule["id"]): OrdoModule => ({ id, name: id, title: id, tagline: "", description: "", features: [], icon: () => null, tint: "", defaultInstalled: true, mobile: true, nav: [], routes: [{ path: `/${id}`, element: null }] }) as unknown as OrdoModule;
const ALL = [mod("basis"), mod("summa"), mod("projekte"), mod("produkte"), mod("produktion")];

let store: VaultStore;
let pid: string;

beforeAll(async () => {
  ({ store } = await VaultStore.create(new MemoryStorage(), { password: "test-passwort-123", profileName: "Test", mode: "business", withRecoveryKey: false }));
  store.mutate((v) => {
    const r = seedDemoVault(v, { today: "2026-10-20" });
    v.activeProfileId = r.ids.business;
  });
  pid = store.activeProfile.id;
  useSession.setState({ store, vault: store.vault, status: "unlocked" } as never);
});

describe("own database", () => {
  it("accepts the public key and refuses secret ones", () => {
    expect(keyProblem("sb_publishable_AbCdEfGhIjKlMnOpQrStUv_WxYz0123")).toBeNull();
    expect(keyProblem("sb_secret_abcdefghijklmnop")).toMatch(/geheime Schlüssel/);
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.sig`;
    expect(keyProblem(jwt("anon"))).toBeNull();
    expect(keyProblem(jwt("service_role"))).toMatch(/service_role/);
    expect(keyProblem("hallo")).toMatch(/sb_publishable_/);
  });

  it("understands the ways people paste a project address", () => {
    expect(normalizeServerUrl("abcdefghijklmnopqrst")).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(normalizeServerUrl("ABCDEFGHIJKLMNOPQRST.supabase.co/")).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(normalizeServerUrl("https://db.muster.at/rest/v1")).toBe("https://db.muster.at");
    expect(normalizeServerUrl("http://db.muster.at")).toBeNull();
    expect(normalizeServerUrl("http://localhost:54321")).toBe("http://localhost:54321");
    expect(isOrdoServer(ORDO_SERVER.url + "/")).toBe(true);
    expect(isOrdoServer("https://abcdefghijklmnopqrst.supabase.co")).toBe(false);
  });

  it("hands a project to another device with a code that holds no secret", () => {
    const t = { url: "https://abcdefghijklmnopqrst.supabase.co", anonKey: "sb_publishable_AbCdEfGhIjKlMnOpQrStUv_WxYz0123" };
    const code = connectionCode(t);
    expect(code.startsWith("ORDO-DB1:")).toBe(true);
    expect(parseConnectionCode(code)).toEqual(t);
    expect(parseConnectionCode("ORDO-DB1:kaputt")).toBeNull();
    expect(parseConnectionCode(connectionCode({ ...t, anonKey: "sb_secret_xyz1234567890" }))).toBeNull();
  });

  it("finds the limit that is closest to full", () => {
    const u: ProjectUsage = { own_project: true, schema_version: 3, db_bytes: 50 * 1048576, storage_bytes: 900 * 1048576, objects: 10, accounts: 3, accounts_max: 50, egress_30d: 1024 * 1048576, active_7d: 2, last_activity: null };
    const peak = usagePeak(u);
    expect(peak.meter.id).toBe("storage");
    expect(peak.share).toBeGreaterThan(0.85);
  });
});

describe("writing data from other programs", () => {
  it("creates once and updates on the second call (externalId)", () => {
    const a = createTransaction(store, pid, { kind: "expense", date: "2026-10-01", amount: "119,90", vatRate: 20, description: "Papier", contactName: "Papier Muster GmbH", externalId: "ER-1" }, "test");
    expect(a.created).toBe(true);
    expect(a.transaction.grossCents).toBe(11990);
    expect(a.transaction.vatLines[0]).toMatchObject({ rate: 20, vatCents: 1998 });
    expect(a.transaction.paidDate).toBe("2026-10-01");
    const b = createTransaction(store, pid, { kind: "expense", date: "2026-10-01", amount: 120, vatRate: 20, description: "Papier", externalId: "ER-1", dueDate: "2026-10-15" }, "test");
    expect(b.created).toBe(false);
    expect(b.transaction.id).toBe(a.transaction.id);
    expect(store.list("transactions", { profileId: pid }).filter((t) => t.legacyRef === "test:ER-1")).toHaveLength(1);
    expect(() => createTransaction(store, pid, { kind: "expense", date: "1.10.2026", amount: 1 }, "test")).toThrow(/date/);
  });

  it("matches contacts by UID and never blanks fields", () => {
    const first = upsertContact(store, pid, { name: "Muster Handel GmbH", uid: "ATU 1234 5678", city: "Wien", kind: "vendor" }, "test");
    const again = upsertContact(store, pid, { name: "Muster Handel", uid: "ATU12345678", city: "", kind: "customer" }, "test");
    expect(again.created).toBe(false);
    expect(again.contact.id).toBe(first.contact.id);
    expect(again.contact.city).toBe("Wien");
    expect(again.contact.kind).toBe("both");
  });

  it("knows where the SAP Service Layer lives", () => {
    expect(serviceLayerBase("https://sap:50000/")).toBe("https://sap:50000/b1s/v2");
    expect(serviceLayerBase("https://sap:50000/b1s/v1")).toBe("https://sap:50000/b1s/v1");
  });
});

describe("webhooks", () => {
  const hook = (cursor: string): Integration => IntegrationSchema.parse({ id: "int_test", kind: "webhook", name: "Test", profileId: pid, url: "https://example.invalid/hook", events: ["contact", "transaction"], secret: "whsec_x", cursor, createdAt: cursor, updatedAt: cursor });

  it("sends only what changed after the cursor, oldest first, in batches that keep equal timestamps together", () => {
    // everything written by earlier tests is at or before `start`; the contacts change comes just after it
    const start = nowIso();
    const now = new Date(Date.parse(start) + 10).toISOString();
    store.mutate((v) => {
      v.contacts = v.contacts.map((c, i) => (c.profileId === pid && i < 60 ? { ...c, updatedAt: now } : c));
    });
    const changedContacts = store.list("contacts", { profileId: pid, includeDeleted: true }).filter((c) => c.updatedAt === now).length;
    expect(changedContacts).toBeGreaterThan(10);
    // a batch of 10 is stretched to all records with the same timestamp, so the cursor never skips one
    const events = pendingEvents(store, hook(start), 10);
    expect(events.length).toBe(changedContacts);
    expect(events.every((e) => e.at > start)).toBe(true);
    expect(new Set(events.map((e) => e.at)).size).toBe(1);
    expect(events[0]!.event).toMatch(/^contact\.(updated|created)$/);
    expect(pendingEvents(store, hook(now), 50)).toEqual([]);
  });
});

describe("Atlas and connections", () => {
  const tools = (areas?: Record<string, string>) => buildToolset({ modules: ALL, role: "owner", permission: "auto", areas });

  it("always asks before touching a connection, even when it may change data freely", () => {
    const t = tools();
    for (const name of ["integration_setup", "integration_update", "integration_test", "integration_probe", "integration_run"]) {
      expect(t.byName.get(name)?.alwaysConfirm).toBe(true);
    }
    expect(t.byName.get("integrations_overview")?.kind).toBe("read");
    expect(tools({ integrations: "none" }).byName.has("integrations_overview")).toBe(false);
    expect(buildToolset({ modules: ALL, role: "member", permission: "auto" }).byName.has("integration_setup")).toBe(false);
  });

  it("never sees or takes a secret", async () => {
    const ctx = toolContext(store, "owner", () => undefined);
    const setup = tools().byName.get("integration_setup")!;
    const refused = await runTool(setup, { kind: "sap_b1", name: "SAP", config: JSON.stringify({ base_url: "https://sap:50000", password: "geheim" }) }, ctx);
    expect(refused.ok).toBe(false);
    const made = await runTool(setup, { kind: "api_key", name: "Skript", config: JSON.stringify({ scopes: ["contacts:read"] }) }, ctx);
    expect(made.ok).toBe(true);
    const secret = store.vault.settings.integrations.find((i) => i.name === "Skript")!.secret;
    expect(secret).toMatch(/^ordo_/);
    expect(made.content).not.toContain(secret);
    const overview = await runTool(tools().byName.get("integrations_overview")!, {}, ctx);
    expect(overview.content).not.toContain(secret);
    expect(overview.content).toContain('"hasSecret":true');
  });

  it("drops the password when Atlas points a connection at another host, and says so first", async () => {
    const ctx = toolContext(store, "owner", () => undefined);
    // the app mirrors every vault change into the session; here that is done by hand
    const sync = () => useSession.setState({ vault: store.vault } as never);
    const made = await runTool(tools().byName.get("integration_setup")!, { kind: "sap_b1", name: "SAP Muster", config: JSON.stringify({ base_url: "https://sap.muster.at:50000", company_db: "MUSTER", user: "manager" }) }, ctx);
    expect(made.ok).toBe(true);
    const id = store.vault.settings.integrations.find((i) => i.name === "SAP Muster")!.id;
    // the person typed the password in the settings
    store.mutate((v) => {
      v.settings.integrations = v.settings.integrations.map((i) => (i.id === id ? { ...i, secret: "geheim" } : i));
    });
    sync();
    const update = tools().byName.get("integration_update")!;
    const secret = () => store.vault.settings.integrations.find((i) => i.id === id)!.secret;
    expect((await runTool(update, { id, config: JSON.stringify({ every_minutes: 30 }) }, ctx)).ok).toBe(true);
    sync();
    expect(secret()).toBe("geheim");
    const away = { id, config: JSON.stringify({ base_url: "https://andere.example:50000" }) };
    expect(update.preview?.(away as never, ctx)).toMatch(/neue Adresse: andere\.example:50000 \(bisher sap\.muster\.at:50000\).*Passwort/);
    expect((await runTool(update, away, ctx)).ok).toBe(true);
    sync();
    expect(secret()).toBe("");
  });

  it("does not change a known contact through an invoice", () => {
    const known = upsertContact(store, pid, { name: "Muster Bank Kunde GmbH", iban: "AT61 1904 3002 3457 3201", kind: "customer" }, "test").contact;
    createTransaction(store, pid, { kind: "income", date: "2026-10-02", amount: 100, vatRate: 20, description: "Test", contactName: "Muster Bank Kunde GmbH" }, "test");
    upsertContact(store, pid, { name: "Muster Bank Kunde GmbH", iban: "DE89370400440532013000", kind: "customer" }, "test", false);
    expect(store.byId("contacts", known.id)!.iban).toBe("AT611904300234573201");
  });

  it("does not import into areas that are closed for Atlas", async () => {
    const ctx = toolContext(store, "owner", () => undefined);
    const setup = tools({ contacts: "read" }).byName.get("integration_setup")!;
    const r = await runTool(setup, { kind: "rest_pull", name: "CRM", config: JSON.stringify({ base_url: "https://crm.example/api/kunden", targets: ["contacts"] }) }, ctx);
    expect(r.ok).toBe(false);
  });
});
