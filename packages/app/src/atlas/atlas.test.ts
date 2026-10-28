import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage, VaultStore, nowIso, seedDemoVault, todayIso, type AtlasMessage, type Role } from "@ordo/core";
import type { OrdoModule } from "@/modules/types";
import { buildToolset, runTool, toolContext } from "./toolset";
import { STRICT_LIMITS, schemaComplexity } from "./schema";
import { pickEffort, route } from "./router";
import { toClaudeMessages } from "./providers/claude";
import { codexPrompt } from "./providers/codex";
import { systemPrompt, turnContext } from "./prompt";

const mod = (id: OrdoModule["id"], atlasContext = ""): OrdoModule =>
  ({ id, name: id, title: id, tagline: "", description: "", features: [], icon: () => null, tint: "", defaultInstalled: true, mobile: true, nav: [], routes: [{ path: `/${id}`, element: null }], atlasContext }) as unknown as OrdoModule;
const ALL = [mod("basis", "Basis: contacts"), mod("summa", "Summa: transactions"), mod("projekte", "Projekte: projects"), mod("produkte"), mod("produktion")];

let store: VaultStore;
const ids = { project: "prj_test", member: "mbr_me", other: "mbr_other", task: "tsk_one", product: "prd_one" };

beforeAll(async () => {
  ({ store } = await VaultStore.create(new MemoryStorage(), { password: "test-passwort-123", profileName: "Test", mode: "business", withRecoveryKey: false }));
  const now = nowIso();
  store.mutate((v) => {
    const r = seedDemoVault(v, { today: "2026-10-20" });
    v.activeProfileId = r.ids.business;
    const pid = r.ids.business;
    v.members = [
      { id: ids.member, createdAt: now, updatedAt: now, name: "Mia Muster", email: "", role: "owner", title: "", hourlyCostCents: 4000, hourlyRateCents: 9000, weeklyHours: 38.5, color: "#0a5fe0", active: true, phone: "", notes: "" },
      { id: ids.other, createdAt: now, updatedAt: now, name: "Max Beispiel", email: "", role: "member", title: "", hourlyCostCents: 3000, hourlyRateCents: 7000, weeklyHours: 38.5, color: "#0a5fe0", active: true, phone: "", notes: "" },
    ];
    v.settings = { ...v.settings, meMemberId: ids.member };
    v.projects = [{ id: ids.project, createdAt: now, updatedAt: now, profileId: pid, number: "P-0001", name: "Website", description: "", status: "active", budgetCents: 1_000_000, budgetHours: 100, billing: "hourly", hourlyRateCents: 9500, memberIds: [], hoursPerDay: 6, color: "#0a5fe0", tags: [], notes: "" }];
    v.tasks = [{ id: ids.task, createdAt: now, updatedAt: now, profileId: pid, projectId: ids.project, order: 1, title: "Logo entwerfen", description: "", status: "todo", priority: "medium", estimateHours: 4, dueDate: "2026-01-10", assigneeIds: [ids.other] },
      { id: "tsk_two", createdAt: now, updatedAt: now, profileId: pid, projectId: ids.project, order: 2, title: "Server einrichten", description: "", status: "todo", priority: "medium", estimateHours: 2, assigneeIds: [] },
    ];
    v.products = [{ id: ids.product, createdAt: now, updatedAt: now, profileId: pid, sku: "A-1", name: "Schraube", description: "", kind: "material", unit: "Stk", priceCents: 50, vatRate: 20, costCents: 20, category: "", trackStock: true, minStock: 100, location: "", barcode: "", active: true, components: [], operations: [] }];
    v.stockMoves = [{ id: "stk_1", createdAt: now, updatedAt: now, profileId: pid, productId: ids.product, date: "2026-10-01", quantity: 40, kind: "receipt", note: "" }];
  });
});

const ctx = (role: Role = "owner") => toolContext(store, role, () => undefined);
const tools = (role: Role = "owner", permission: "read" | "confirm" | "auto" = "auto", modules = ALL, areas?: Record<string, string>) => buildToolset({ modules, role, permission, areas });
const call = async (name: string, input: unknown, role: Role = "owner", areas?: Record<string, string>) => {
  const t = tools(role, "auto", ALL, areas).byName.get(name);
  if (!t) throw new Error(`tool ${name} missing`);
  return runTool(t, input, ctx(role));
};

describe("toolset", () => {
  it("sends strict-ready schemas in a stable order and stays inside the strict limits", () => {
    const a = tools();
    const b = tools();
    expect(JSON.stringify(a.defs)).toBe(JSON.stringify(b.defs));
    const strict = a.defs.filter((d) => d.strict);
    expect(strict.length).toBeLessThanOrEqual(STRICT_LIMITS.tools);
    expect(strict.reduce((s, d) => s + schemaComplexity(d.schema).optional, 0)).toBeLessThanOrEqual(STRICT_LIMITS.optional);
    expect(strict.reduce((s, d) => s + JSON.stringify(d.schema).length, 0)).toBeLessThanOrEqual(STRICT_LIMITS.chars);
    // write tools get the strict slots first
    expect(a.defs.find((d) => d.kind === "write")?.strict).toBe(true);
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      for (const bad of ["pattern", "minimum", "maximum", "default", "$schema", "format"]) expect(o[bad]).toBeUndefined();
      if (o.type === "object") expect(o.additionalProperties).toBe(false);
      Object.values(o).forEach(walk);
    };
    a.defs.forEach((d) => walk(d.schema));
  });

  it("sends no write tool when Atlas may only read, and follows the role", () => {
    expect(tools("owner", "read").defs.some((d) => d.kind === "write")).toBe(false);
    expect(tools("viewer", "auto").defs.some((d) => d.kind === "write")).toBe(false);
    const member = tools("member", "auto").byName;
    expect(member.has("log_time")).toBe(true);
    expect(member.has("set_task_status")).toBe(true);
    expect(member.has("create_project")).toBe(false);
    expect(member.has("book_transaction")).toBe(false);
    expect(member.has("tax_overview")).toBe(false);
  });

  it("only offers tools of installed modules", () => {
    const t = tools("owner", "auto", [ALL[0]!, ALL[1]!]).byName;
    expect(t.has("tax_overview")).toBe(true);
    expect(t.has("project_status")).toBe(false);
    expect(t.has("log_time")).toBe(false);
    expect(t.has("stock_status")).toBe(false);
  });
});

describe("read tools on the demo workspace", () => {
  it("describes the workspace and searches", async () => {
    const d = await call("describe_workspace", {});
    expect(d.ok).toBe(true);
    expect(JSON.parse(d.content).counts.transactions).toBeGreaterThan(100);
    const s = await call("search", { query: "website" });
    expect(s.ok).toBe(true);
    expect(JSON.parse(s.content).hits[0].id).toBe(ids.project);
  });

  it("lists with filters and aggregates by month with money formatting", async () => {
    const l = await call("list_records", { collection: "transactions", filters: [{ field: "kind", op: "eq", value: "income" }], limit: 5 });
    const data = JSON.parse(l.content);
    expect(data.records).toHaveLength(5);
    expect(data.records.every((r: { kind: string }) => r.kind === "income")).toBe(true);
    expect(data.records[0].grossCents_eur).toMatch(/€/);
    const a = await call("aggregate", { collection: "transactions", metric: "sum", field: "grossCents", period: "quarter", filters: [{ field: "kind", op: "eq", value: "income" }] });
    const agg = JSON.parse(a.content);
    expect(agg.rows.length).toBeGreaterThan(1);
    expect(agg.rows[0].periodLabel).toMatch(/^Q\d \d{4}$/);
    expect(agg.total_eur).toMatch(/€/);
    const byContact = await call("aggregate", { collection: "transactions", metric: "sum", field: "grossCents", group_by: "contactId", filters: [{ field: "kind", op: "eq", value: "income" }] });
    expect(JSON.parse(byContact.content).rows[0].group).not.toMatch(/^ctc_/);
  });

  it("explains a project, taxes and stock", async () => {
    const p = JSON.parse((await call("project_status", { project: "Website" })).content);
    expect(p.tasks.overdue).toBe(1);
    const t = await call("tax_overview", { kind: "uva", year: 2026, period: 3 });
    expect(t.ok).toBe(true);
    expect(JSON.parse(t.content).kind).toBe("UVA");
    const e = await call("tax_overview", { kind: "e1a", year: 2026 });
    expect(JSON.parse(e.content).gewinn_eur).toMatch(/€/);
    const st = JSON.parse((await call("stock_status", { only_low: true })).content);
    expect(st.items[0].onHand).toBe(40);
  });

  it("gives Mitarbeit only their own time entries in every read tool, project totals stay", async () => {
    const pid = store.activeProfile.id;
    const at = nowIso();
    const row = (id: string, memberId: string, minutes: number) => ({ id, profileId: pid, projectId: ids.project, memberId, date: "2026-10-19", minutes, description: `Eintrag ${id}`, billable: true, createdAt: at, updatedAt: at });
    store.mutate((v) => { v.timeEntries = [...v.timeEntries, row("tim_mine", ids.member, 60), row("tim_other", ids.other, 120)]; });
    try {
      const list = (role: Role) => call("list_records", { collection: "timeEntries", filters: [{ field: "projectId", op: "eq", value: ids.project }], limit: 50 }, role).then((r) => JSON.parse(r.content).records as { id: string }[]);
      const sum = (role: Role) => call("aggregate", { collection: "timeEntries", metric: "sum", field: "minutes", filters: [{ field: "projectId", op: "eq", value: ids.project }] }, role).then((r) => JSON.parse(r.content).total as number);
      const ownerIds = (await list("owner")).map((r) => r.id);
      expect(ownerIds).toEqual(expect.arrayContaining(["tim_mine", "tim_other"]));
      const memberIds = (await list("member")).map((r) => r.id);
      expect(memberIds).toContain("tim_mine");
      expect(memberIds).not.toContain("tim_other");
      expect((await sum("owner")) - (await sum("member"))).toBeGreaterThanOrEqual(120);
      const search = JSON.parse((await call("search", { query: "Eintrag tim_other" }, "member")).content);
      expect(JSON.stringify(search)).not.toContain("tim_other");
      // the project's total hours are not personal and stay the same for everyone
      const total = (role: Role) => call("project_status", { project: "Website" }, role).then((r) => JSON.parse(r.content).hoursLogged);
      expect(await total("member")).toBe(await total("owner"));
      // the snapshot is filtered, the vault is not
      expect(store.vault.timeEntries.some((e) => e.id === "tim_other")).toBe(true);
    } finally {
      store.mutate((v) => { v.timeEntries = v.timeEntries.filter((e) => e.id !== "tim_mine" && e.id !== "tim_other"); });
    }
  });

  it("shows hours per person and team load only to roles that may see everyone's time", async () => {
    const owner = JSON.parse((await call("project_status", { project: "Website" })).content);
    expect(owner).toHaveProperty("hoursByPerson");
    expect(owner).toHaveProperty("workPackages");
    expect((await call("team_load", {})).ok).toBe(true);
    // a member books only their own time: no one else's hours, no team utilisation
    const member = JSON.parse((await call("project_status", { project: "Website" }, "member")).content);
    expect(member).not.toHaveProperty("hoursByPerson");
    const load = await call("team_load", {}, "member");
    expect(load.ok).toBe(false);
    // the team area closed in Einstellungen → Atlas hides it from the owner too
    const closed = JSON.parse((await call("project_status", { project: "Website" }, "owner", { team: "none" })).content);
    expect(closed).not.toHaveProperty("hoursByPerson");
  });

  it("returns readable errors and validates chart input", async () => {
    const r = await call("get_record", { collection: "projects", id: "gibtsnicht" });
    expect(r.ok).toBe(false);
    expect(JSON.parse(r.content).error).toMatch(/Keine Projekte/);
    const bad = await call("show_chart", { kind: "bar", title: "x", labels: ["a", "b"], series: [{ name: "n", values: [1] }], unit: "count" });
    expect(bad.ok).toBe(false);
    const ok = await call("show_chart", { kind: "bar", title: "Umsatz", labels: ["Jän", "Feb"], series: [{ name: "Einnahmen", values: [12345, 20000] }], unit: "eur" });
    expect(ok.result?.visual?.type).toBe("chart");
    if (ok.result?.visual?.type === "chart") expect(ok.result.visual.chart.data[0]!.Einnahmen).toBe(123.45);
    const invalid = await call("list_records", { collection: "transactions", limit: 500 });
    expect(invalid.ok).toBe(false);
  });
});

describe("write tools", () => {
  it("logs time with rates, creates tasks, books and drafts offers", async () => {
    const before = store.vault.timeEntries.length;
    const t = await call("log_time", { project: "Website", hours: 2, date: "2026-10-20", description: "Layout" });
    expect(t.ok).toBe(true);
    const entry = store.vault.timeEntries[before]!;
    expect(entry.minutes).toBe(120);
    expect(entry.memberId).toBe(ids.member);
    expect(entry.rateCents).toBe(9500);
    const task = await call("create_task", { project: "P-0001", title: "Texte schreiben", assignee: "Max" });
    expect(task.ok).toBe(true);
    expect(store.vault.tasks.find((x) => x.title === "Texte schreiben")?.assigneeIds).toEqual([ids.other]);
    const tx = await call("book_transaction", { kind: "expense", date: "2026-10-20", description: "Druckerpapier", gross_cents: 1200, vat_rate: 20, payment_method: "card" });
    expect(tx.ok).toBe(true);
    const booked = store.vault.transactions.find((x) => x.description === "Druckerpapier")!;
    expect(booked.vatLines[0]).toEqual({ rate: 20, netCents: 1000, vatCents: 200 });
    const counter = store.vault.settings.projects.nextOfferNumber;
    const offer = await call("create_offer_draft", { subject: "Relaunch", project: "Website", lines: [{ title: "Design", quantity: 10, unit: "Std", unit_net_cents: 9500, vat_rate: 20 }] });
    expect(offer.ok).toBe(true);
    expect(store.vault.settings.projects.nextOfferNumber).toBe(counter + 1);
    expect(store.vault.offers.at(-1)!.status).toBe("draft");
  });

  it("creates, updates and deletes generic records with validation", async () => {
    const c = await call("create_record", { collection: "contacts", data_json: JSON.stringify({ name: "Huber GmbH", kind: "customer", id: "evil", profileId: "other" }) });
    expect(c.ok).toBe(true);
    const contact = store.vault.contacts.find((x) => x.name === "Huber GmbH")!;
    expect(contact.id).not.toBe("evil");
    expect(contact.profileId).toBe(store.activeProfile.id);
    const bad = await call("create_record", { collection: "contacts", data_json: JSON.stringify({ kind: "customer" }) });
    expect(bad.ok).toBe(false);
    const u = await call("update_record", { collection: "contacts", id: "Huber GmbH", patch_json: JSON.stringify({ city: "Graz" }) });
    expect(u.ok).toBe(true);
    expect(store.vault.contacts.find((x) => x.id === contact.id)!.city).toBe("Graz");
    const d = await call("delete_record", { collection: "contacts", id: contact.id });
    expect(d.ok).toBe(true);
    expect(store.vault.contacts.find((x) => x.id === contact.id)!.deletedAt).toBeTruthy();
  });

  it("lets a member change only their own task", async () => {
    store.mutate((v) => {
      v.settings = { ...v.settings, meMemberId: ids.other };
    });
    try {
      const own = await call("set_task_status", { task: "Logo entwerfen", status: "done" }, "member");
      expect(own.ok).toBe(true);
      expect(store.vault.tasks.find((t) => t.id === ids.task)!.completedAt).toBeTruthy();
      const notOwn = await call("set_task_status", { task: "Server einrichten", status: "done" }, "member");
      expect(notOwn.ok).toBe(false);
      expect(store.vault.tasks.find((t) => t.id === "tsk_two")!.status).toBe("todo");
    } finally {
      store.mutate((v) => {
        v.settings = { ...v.settings, meMemberId: ids.member };
      });
    }
  });
});

describe("area access (Einstellungen → Atlas)", () => {
  it("a closed area does not exist for Atlas: not in search, lists, counts or related summaries", async () => {
    const contact = store.vault.contacts.find((c) => !c.deletedAt && c.profileId === store.activeProfile.id && c.name.length > 3)!;
    const open = JSON.parse((await call("search", { query: contact.name })).content);
    expect(open.hits.some((h: { collection: string }) => h.collection === "contacts")).toBe(true);

    const closed = { contacts: "none" };
    const s = JSON.parse((await call("search", { query: contact.name }, "owner", closed)).content);
    expect(s.hits.some((h: { collection: string }) => h.collection === "contacts")).toBe(false);
    expect((await call("search", { query: contact.name, collections: ["contacts"] }, "owner", closed)).ok).toBe(false);
    expect((await call("list_records", { collection: "contacts" }, "owner", closed)).ok).toBe(false);
    expect((await call("get_record", { collection: "contacts", id: contact.id }, "owner", closed)).ok).toBe(false);
    const counts = JSON.parse((await call("describe_workspace", {}, "owner", closed)).content).counts;
    expect(counts.contacts).toBeUndefined();
    expect(counts.transactions).toBeGreaterThan(0);
    // names from the closed area are not printed next to ids, and grouping by them is refused
    const tx = JSON.parse((await call("list_records", { collection: "transactions", filters: [{ field: "contactId", op: "not_empty", value: "" }], limit: 3 }, "owner", closed)).content);
    expect(tx.records.length).toBeGreaterThan(0);
    expect(tx.records.every((r: Record<string, unknown>) => r.contactName === undefined)).toBe(true);
    expect((await call("aggregate", { collection: "transactions", metric: "sum", field: "grossCents", group_by: "contactId" }, "owner", closed)).ok).toBe(false);
    // related summaries leave out closed areas
    const p = JSON.parse((await call("get_record", { collection: "projects", id: "Website" }, "owner", { time: "none" })).content);
    expect(p.related.hoursLogged).toBeUndefined();
    expect(p.related.tasks).toBeTruthy();
    // no tool schema mentions the closed collection
    expect(JSON.stringify(tools("owner", "auto", ALL, closed).defs)).not.toMatch(/"contacts"/);
    expect(JSON.stringify(tools("owner", "auto", ALL, { bank: "none" }).defs)).not.toMatch(/bankLines/);
    expect(tools("owner", "auto", ALL, { taxes: "none" }).byName.has("tax_overview")).toBe(false);
    // a write tool that would need a closed area for a lookup explains why
    const offer = await call("create_offer_draft", { subject: "Test", customer: contact.name, lines: [{ title: "x", quantity: 1, unit: "Stk", unit_net_cents: 100, vat_rate: 20 }] }, "owner", closed);
    expect(offer.ok).toBe(false);
    expect(offer.error).toMatch(/gesperrt/);
  });

  it("the stricter of role, global permission and area wins", () => {
    const readOnlyArea = tools("owner", "auto", ALL, { time: "read", projects: "read" }).byName;
    expect(readOnlyArea.has("log_time")).toBe(false);
    expect(readOnlyArea.has("create_task")).toBe(false);
    expect(readOnlyArea.has("project_status")).toBe(true);
    expect(tools("owner", "read", ALL, { outgoing: "write" }).byName.has("create_invoice_draft")).toBe(false);
    expect(tools("manager", "auto", ALL, { outgoing: "write" }).byName.has("create_invoice_draft")).toBe(false);
    expect(tools("member", "auto", ALL, { bookkeeping: "write" }).byName.has("book_transaction")).toBe(false);
  });

  it("outgoing invoices are read-only by default, drafts only when opened", () => {
    const def = tools();
    expect(def.byName.has("check_invoice")).toBe(true);
    expect(def.byName.has("create_invoice_draft")).toBe(false);
    expect(def.byName.has("update_invoice_draft")).toBe(false);
    const open = tools("owner", "auto", ALL, { outgoing: "write" });
    expect(open.byName.has("create_invoice_draft")).toBe(true);
    expect(open.byName.has("update_invoice_draft")).toBe(true);
    // more write tools never push the strict tools past the grammar budget
    expect(open.defs.filter((d) => d.strict).reduce((s, d) => s + JSON.stringify(d.schema).length, 0)).toBeLessThanOrEqual(STRICT_LIMITS.chars);
    // team is read-only by default too: no generic write tool offers members
    expect(def.defs.some((d) => d.kind === "write" && JSON.stringify(d.schema).includes('"members"'))).toBe(false);
  });

  it("drafts, edits and checks invoices, but never touches a sent or paid one", async () => {
    const write = { outgoing: "write" };
    const contact = store.vault.contacts.find((c) => !c.deletedAt && c.profileId === store.activeProfile.id && c.street && c.city)!;
    const counter = store.activeProfile.company.nextInvoiceNumber;
    const r = await call("create_invoice_draft", { customer: contact.id, project: "Website", service_period: { start: "2026-10-01", end: "2026-10-15" }, lines: [{ title: "Webdesign", description: "Startseite und Unterseiten", quantity: 10, unit: "Std", unit_net_cents: 9500, vat_rate: 20 }] }, "owner", write);
    expect(r.ok).toBe(true);
    const created = JSON.parse(r.content);
    const inv = store.vault.invoices.find((x) => x.id === created.id)!;
    expect(inv.status).toBe("draft");
    expect(inv.projectId).toBe(ids.project);
    expect(inv.customerSnapshot.name).toBe(contact.name);
    expect(inv.lines[0]!.description).toBe("Webdesign\nStartseite und Unterseiten");
    expect(store.activeProfile.company.nextInvoiceNumber).toBeGreaterThan(counter);
    expect(store.vault.invoices.filter((x) => x.number === inv.number && !x.deletedAt)).toHaveLength(1);
    expect(r.result?.link?.to).toBe(`/rechnungen/${inv.id}`);
    expect(created.totals.grossCents).toBe(114_000);
    expect(Array.isArray(created.check.findings)).toBe(true);

    const u = await call("update_invoice_draft", { invoice: inv.number, due_date: "2026-11-30" }, "owner", write);
    expect(u.ok).toBe(true);
    expect(store.vault.invoices.find((x) => x.id === inv.id)!.dueDate).toBe("2026-11-30");

    const issued = store.vault.invoices.find((x) => !x.deletedAt && x.profileId === store.activeProfile.id && (x.status === "sent" || x.status === "paid"))!;
    expect(issued).toBeTruthy();
    const before = JSON.stringify(issued);
    const refused = await call("update_invoice_draft", { invoice: issued.id, due_date: "2030-01-01" }, "owner", write);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/nur Entwürfe/);
    expect(JSON.stringify(store.vault.invoices.find((x) => x.id === issued.id))).toBe(before);

    // § 11 check: a big invoice without customer UID and without service date is flagged
    store.mutate((v) => {
      v.contacts = v.contacts.map((c) => (c.id === contact.id ? { ...c, uid: "" } : c));
    });
    const big = await call("create_invoice_draft", { customer: contact.id, lines: [{ title: "Großauftrag", description: "", quantity: 1, unit: "pauschal", unit_net_cents: 1_000_000, vat_rate: 20 }] }, "owner", write);
    expect(big.ok).toBe(true);
    const bigInv = store.vault.invoices.find((x) => x.id === JSON.parse(big.content).id)!;
    const check = JSON.parse((await call("check_invoice", { invoice: bigInv.number })).content);
    expect(check.ok).toBe(false);
    expect(check.findings.some((f: { level: string; text: string }) => f.level === "fehler" && /UID-Nummer des Kunden/.test(f.text))).toBe(true);
    expect(check.findings.some((f: { text: string }) => /Leistungsdatum/.test(f.text))).toBe(true);
  });
});

describe("prompt, routing and transcripts", () => {
  it("keeps the system prompt free of per-request data", () => {
    const a = systemPrompt(ALL, "Antworte kurz.");
    expect(a).toBe(systemPrompt(ALL, "Antworte kurz."));
    expect(a).not.toContain(todayIso());
    expect(a).not.toContain(store.activeProfile.name);
    const c = turnContext({ today: "2026-10-21", profile: store.activeProfile, role: "owner", permission: "confirm", page: "/projekte" });
    expect(c).toMatch(/Mittwoch, 21\.10\.2026/);
    expect(c).toMatch(/Aktuelle Seite: \/projekte/);
  });

  it("answers short by default, and the skills can be switched", () => {
    expect(systemPrompt(ALL, "")).toContain("Antwortlänge: kurz");
    const off = systemPrompt(ALL, "", { short: false, net: true });
    expect(off).not.toContain("Antwortlänge: kurz");
    expect(off).toContain("netto");
  });

  it("picks the effort per request", () => {
    expect(pickEffort("Welche Aufgaben sind überfällig?")).toBe("low");
    expect(pickEffort("Erfasse 2 Stunden auf das Projekt Website")).toBe("medium");
    expect(pickEffort("Wie lief das letzte Quartal?")).toBe("high");
    expect(pickEffort("Umsatz pro Kunde als Diagramm")).toBe("high");
    expect(pickEffort("Leg drei Aufgaben an und setze danach das Projekt auf aktiv")).toBe("high");
    const r = route({ provider: "claude", model: "auto", permission: "confirm", consent: true, instructions: "", codexModel: "", openaiModel: "gpt-5.4", areas: {}, skills: {} }, "Hallo?");
    expect(r.model).toBe("claude-opus-5-5");
    expect(route({ provider: "claude", model: "claude-haiku-5-5", permission: "confirm", consent: true, instructions: "", codexModel: "", openaiModel: "gpt-5.4", areas: {}, skills: {} }, "x").effort).toBe("medium");
    expect(route({ provider: "openai", model: "auto", permission: "confirm", consent: true, instructions: "", codexModel: "", openaiModel: "gpt-5.4", areas: {}, skills: {} }, "Wie lief das letzte Quartal?")).toMatchObject({ provider: "openai", model: "gpt-5.4", effort: "high" });
  });

  it("turns the stored chat into valid Messages API turns", () => {
    const at = nowIso();
    const m = (x: Partial<AtlasMessage> & Pick<AtlasMessage, "role">): AtlasMessage => ({ id: Math.random().toString(36), text: "", at, toolCalls: [], visuals: [], ...x });
    const history: AtlasMessage[] = [
      m({ role: "user", text: "Wie viel?", raw: { context: "<kontext>x</kontext>" } }),
      m({ role: "assistant", text: "", toolCalls: [{ id: "toolu_1", name: "search", input: {}, status: "done", summary: "" }, { id: "toolu_2", name: "log_time", input: {}, status: "denied", summary: "" }], raw: { provider: "claude", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "toolu_1", name: "search", input: {} }, { type: "tool_use", id: "toolu_2", name: "log_time", input: {} }] } }),
      m({ role: "tool", text: '{"hits":[]}', toolCallId: "toolu_1" }),
      m({ role: "assistant", text: "Abgebrochen", raw: { local: true } }),
      m({ role: "user", text: "Weiter", raw: { context: "<kontext>y</kontext>" } }),
    ];
    const msgs = toClaudeMessages(history);
    expect(msgs.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    const last = msgs[2]!.content as { type: string; tool_use_id?: string; is_error?: boolean; text?: string }[];
    expect(last.map((b) => b.type)).toEqual(["tool_result", "tool_result", "text", "text"]);
    expect(last[1]!.tool_use_id).toBe("toolu_2");
    expect(last[1]!.is_error).toBe(true);
    expect(last[2]!.text).toBe("<kontext>y</kontext>");
    expect((msgs[1]!.content as { type: string }[])[0]!.type).toBe("thinking");
  });

  it("builds a Codex prompt with the tool catalogue and the transcript", () => {
    const t = tools();
    const p = codexPrompt({ system: "SYS", tools: t.defs, history: [{ id: "1", role: "user", text: "Hallo", at: nowIso(), toolCalls: [], visuals: [] }], model: "", effort: "low", maxTokens: 1, signal: new AbortController().signal, onText: () => undefined });
    expect(p).toMatch(/### describe_workspace/);
    expect(p).toMatch(/### Person\nHallo/);
    expect(p).toMatch(/tool_calls/);
  });
});

describe("OpenAI transcript", () => {
  it("replays its own tool calls and folds foreign ones into text", async () => {
    const { toOpenAiInput } = await import("./providers/openai");
    const at = "2026-10-22T10:00:00.000Z";
    const items = toOpenAiInput([
      { id: "1", role: "user", text: "Wie viel ist offen?", at, toolCalls: [], visuals: [] },
      { id: "2", role: "assistant", text: "", at, toolCalls: [{ id: "call_a", name: "list_open", input: { x: 1 }, status: "done", summary: "" }], visuals: [], raw: { provider: "openai" } },
      { id: "3", role: "tool", text: '{"sum":5}', at, toolCalls: [], visuals: [], toolCallId: "call_a" },
      { id: "4", role: "assistant", text: "5 € sind offen.", at, toolCalls: [], visuals: [], raw: { provider: "openai" } },
      { id: "5", role: "assistant", text: "Erledigt", at, toolCalls: [{ id: "c9", name: "add_time", input: {}, status: "done", summary: "2 h" }], visuals: [], raw: { provider: "claude" } },
      { id: "6", role: "tool", text: "{}", at, toolCalls: [], visuals: [], toolCallId: "c9" },
    ]);
    expect(items).toEqual([
      { role: "user", content: "Wie viel ist offen?" },
      { type: "function_call", call_id: "call_a", name: "list_open", arguments: '{"x":1}' },
      { type: "function_call_output", call_id: "call_a", output: '{"sum":5}' },
      { role: "assistant", content: "5 € sind offen." },
      { role: "assistant", content: "Erledigt\n[add_time: 2 h]" },
    ]);
  });
});

describe("Pictures for Atlas", () => {
  it("adds an image still in memory to the person's message, for Claude and OpenAI", async () => {
    const { rememberImage } = await import("./vision");
    const { toOpenAiInput } = await import("./providers/openai");
    expect(await rememberImage("att_shot1", new Uint8Array([1, 2, 3]), "image/png", { screen: true, width: 10, height: 10 })).toBe(true);
    const at = "2026-10-23T10:00:00.000Z";
    const history: AtlasMessage[] = [{ id: "1", role: "user", text: "Was ist das?\n\n📎 Bildschirmfoto.png (3 B) – Bildschirmfoto von Ordo [Datei-ID: att_shot1]\n📎 alt.png (1 B) – Bild [Datei-ID: att_gone]", at, toolCalls: [], visuals: [] }];
    const claude = toClaudeMessages(history)[0]!.content as { type: string; source?: { data: string; media_type: string } }[];
    expect(claude.filter((b) => b.type === "image")).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } }]);
    const openai = toOpenAiInput(history)[0] as { content: { type: string; image_url?: string }[] };
    expect(openai.content.filter((c) => c.type === "input_image")).toEqual([{ type: "input_image", image_url: "data:image/png;base64,AQID" }]);
    // without a picture in memory the message stays plain text
    expect(toOpenAiInput([{ ...history[0]!, text: "Hallo" }])[0]).toEqual({ role: "user", content: "Hallo" });
  });
});
