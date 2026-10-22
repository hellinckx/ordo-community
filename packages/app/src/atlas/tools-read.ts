import { z } from "zod";
import {
  ROLE_LABELS,
  computeE1a,
  computeL1,
  computeUva,
  formatCents,
  periodForDate,
  uvaPeriodRange,
  type Vault,
} from "@ordo/core";
import type { ModuleId } from "@/modules/types";
import { AtlasToolError, defineTool, type AtlasChartSpec, type AtlasTool, type AtlasToolContext } from "./tools";
import { COLLECTION_BY_ID, assertFieldsVisible, assertRefsVisible, full, matches, project, recordsOf, resolveRecord, searchWords, stockOnHand, type CollectionDef, type Rec, type ViewOpts } from "./data";
import { atLeast, type AtlasArea, type AtlasLevel } from "./areas";
import { FilterSchema, aggregate, applyFilters, periodLabel, projectFigures, sortRows } from "./query";

export interface ToolEnv {
  /** Collections the person may see in the installed modules, in a fixed order. */
  defs: CollectionDef[];
  modules: ModuleId[];
  /** Route prefixes of the installed modules (for open_page). */
  routes: string[];
  moduleNames: string[];
  /** Effective right of Atlas in an area (role, global permission and area setting). */
  level(area: AtlasArea): AtlasLevel;
}

/** Whether Atlas may see a collection at all (installed, role and area allow it). */
export function visibleIn(env: ToolEnv): (coll: string) => boolean {
  const set = new Set<string>(env.defs.map((d) => d.id));
  return (coll) => set.has(coll);
}

/** Wage-related rates are shown only to those who manage the team – and never when the team area is closed. */
export function hidesRates(env: ToolEnv, ctx: AtlasToolContext): boolean {
  return !ctx.can("team", "write") || !atLeast(env.level("team"), "read");
}

/** View options for records shown to the model. */
export function viewOpts(env: ToolEnv, ctx: AtlasToolContext): ViewOpts {
  return { hideRates: hidesRates(env, ctx), visible: visibleIn(env) };
}

const eur = (c: number) => formatCents(c);

function collEnum(defs: CollectionDef[]) {
  const ids = defs.map((d) => d.id) as [string, ...string[]];
  return z.enum(ids);
}

function defOf(env: ToolEnv, id: string): CollectionDef {
  const def = env.defs.find((d) => d.id === id);
  if (!def) throw new AtlasToolError(`Die Sammlung „${id}“ gibt es hier nicht oder sie ist für deine Rolle nicht sichtbar.`);
  return def;
}

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** Search order when matches are equally good: named things first, the many bookings last. */
const SEARCH_PRIORITY = ["contacts", "projects", "tasks", "offers", "invoices", "products", "workOrders", "members", "milestones", "files", "documents", "transactions"];

export function readTools(env: ToolEnv): AtlasTool[] {
  if (!env.defs.length) return [];
  const COLL = collEnum(env.defs);
  const searchable = env.defs.filter((d) => ["contacts", "projects", "tasks", "offers", "invoices", "transactions", "products", "workOrders", "files", "documents", "members", "milestones"].includes(d.id));
  const tools: AtlasTool[] = [];

  tools.push(
    defineTool({
      name: "describe_workspace",
      description:
        "Überblick über den Arbeitsbereich: heutiges Datum, aktives Profil (Firma/Privat, Steuerdaten), installierte Module, deine Rolle, Anzahl Datensätze je Sammlung und laufende Stoppuhren. Nutze das zu Beginn, wenn du nicht weißt, welche Daten es gibt.",
      input: z.object({}),
      kind: "read",
      run(_input, ctx) {
        const v = ctx.vault;
        const counts: Record<string, number> = {};
        for (const d of env.defs) counts[d.id] = recordsOf(v, d, ctx.profileId).length;
        const p = ctx.profile;
        const see = visibleIn(env);
        const timers = see("timeEntries")
          ? v.settings.timers.map((t) => ({ project: see("projects") ? v.projects.find((x) => x.id === t.projectId)?.name : undefined, member: see("members") ? v.members.find((m) => m.id === t.memberId)?.name : undefined, startedAt: t.startedAt, description: t.description }))
          : undefined;
        return {
          summary: "Überblick gelesen",
          data: {
            today: ctx.today,
            weekday: WEEKDAYS[new Date(`${ctx.today}T12:00:00`).getDay()],
            profile: {
              name: p.name,
              kind: p.mode === "business" ? "Firma" : "Privat (angestellt)",
              company: p.company.name || undefined,
              vatRegime: p.vatRegime,
              accountingMethod: p.accountingMethod,
              uvaPeriod: p.uvaPeriod,
            },
            person: { name: ctx.member?.name, role: ROLE_LABELS[ctx.role] },
            modules: env.moduleNames,
            counts,
            runningTimers: timers,
          },
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "search",
      description:
        "Volltextsuche über Kontakte, Projekte, Aufgaben, Angebote, Rechnungen, Buchungen, Produkte, Fertigungsaufträge und Dateien. Nutze das, wenn die Person etwas beim Namen nennt (\"Projekt Website\", \"Firma Huber\") und du die id brauchst.",
      input: z.object({
        query: z.string().describe("Suchbegriff, z. B. ein Name, eine Nummer oder ein Stichwort"),
        collections: z.array(collEnum(searchable.length ? searchable : env.defs)).optional().describe("Nur in diesen Sammlungen suchen"),
        limit: z.number().int().min(1).max(30).optional().describe("Höchstens so viele Treffer (Standard 15)"),
      }),
      kind: "read",
      run(input, ctx) {
        const words = searchWords(input.query);
        if (!words.length) throw new AtlasToolError("Bitte einen Suchbegriff angeben.");
        const v = ctx.vault;
        const limit = input.limit ?? 15;
        const pool = input.collections?.length ? env.defs.filter((d) => input.collections!.includes(d.id)) : searchable;
        const scored: { score: number; prio: number; def: CollectionDef; r: Rec }[] = [];
        const q = words.join(" ");
        for (const def of pool) {
          const prio = SEARCH_PRIORITY.indexOf(def.id);
          for (const r of recordsOf(v, def, ctx.profileId)) {
            if (!matches(def, r, v, words)) continue;
            const title = searchWords(def.title(r, v)).join(" ");
            const score = title === q ? 3 : title.includes(q) ? 2 : words.every((w) => title.includes(w)) ? 1.5 : 1;
            scored.push({ score, prio: prio < 0 ? 99 : prio, def, r });
          }
        }
        scored.sort((a, b) => b.score - a.score || a.prio - b.prio);
        const hits = scored.slice(0, limit).map(({ def, r }) => ({ collection: def.id, title: def.title(r, v), path: def.path(r), ...project(def, r, v, undefined, viewOpts(env, ctx)) }));
        const shown = hits;
        return { summary: scored.length ? `${scored.length} Treffer für „${input.query}“` : `Nichts gefunden für „${input.query}“`, data: { total: scored.length, hits: shown } };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "list_records",
      description:
        "Listet Datensätze einer Sammlung mit Filtern, Sortierung und ausgewählten Feldern. Beträge sind in Cent (dazu eine formatierte Kopie *_eur). Für Summen und Auswertungen nimm aggregate statt list_records.",
      input: z.object({
        collection: COLL,
        filters: z.array(FilterSchema).optional().describe("Alle Filter müssen zutreffen"),
        sort: z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }).optional().describe("Standard: Hauptdatum absteigend"),
        limit: z.number().int().min(1).max(50).optional().describe("Höchstens 50, Standard 20"),
        fields: z.array(z.string()).optional().describe("Nur diese Felder ausgeben (id kommt immer mit)"),
      }),
      kind: "read",
      run(input, ctx) {
        const def = defOf(env, input.collection);
        const v = ctx.vault;
        const used = [...(input.filters ?? []).map((f) => f.field), input.sort?.field];
        assertFieldsVisible(def.id, used, hidesRates(env, ctx));
        assertRefsVisible(def, [...used, ...(input.fields ?? [])], visibleIn(env), { namesOnly: true });
        const rows = sortRows(def, applyFilters(def, recordsOf(v, def, ctx.profileId), input.filters, v), v, input.sort);
        const limit = Math.min(input.limit ?? 20, 50);
        const records = rows.slice(0, limit).map((r) => project(def, r, v, input.fields, viewOpts(env, ctx)));
        return {
          summary: `${rows.length} ${def.label}${input.filters?.length ? " (gefiltert)" : ""}`,
          data: { collection: def.id, total: rows.length, shown: records.length, records, ...(rows.length > limit ? { note: `Nur die ersten ${limit} von ${rows.length}. Für Summen aggregate nutzen.` } : {}) },
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "get_record",
      description: "Holt einen Datensatz vollständig (per id, Nummer oder Name) mit einer kurzen Zusammenfassung verknüpfter Daten, z. B. Stunden und Budget eines Projekts oder offene Rechnungen eines Kunden.",
      input: z.object({ collection: COLL, id: z.string().describe("id, Nummer oder Name") }),
      kind: "read",
      run(input, ctx) {
        const def = defOf(env, input.collection);
        const v = ctx.vault;
        const r = resolveRecord(v, def, ctx.profileId, input.id);
        return { summary: `${def.title(r, v)} geöffnet`, data: { collection: def.id, path: def.path(r), record: full(def, r, v, viewOpts(env, ctx)), related: related(env, def, r, ctx) } };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "aggregate",
      description:
        "Rechnet Summen, Anzahl, Durchschnitt, Minimum oder Maximum über eine Sammlung – gruppiert nach einem Feld (z. B. contactId, categoryId, status, projectId) und/oder nach Monat, Quartal oder Jahr eines Datumsfelds. Nutze das für alle Auswertungen (\"Umsatz pro Kunde\", \"Ausgaben je Monat\", \"Stunden pro Projekt\"). Buchungen: kind income = Einnahmen, expense = Ausgaben; grossCents brutto, netCents netto; Datum = effectiveDate (bezahlt am, sonst Datum).",
      input: z.object({
        collection: COLL,
        metric: z.enum(["sum", "count", "avg", "min", "max"]),
        field: z.string().optional().describe("Zahlenfeld für sum/avg/min/max, z. B. grossCents, netCents, totalCents, minutes, hours, quantity"),
        group_by: z.string().optional().describe("Feld zum Gruppieren, z. B. contactId, customerId, categoryId, projectId, status, kind, memberId"),
        period: z.enum(["month", "quarter", "year"]).optional().describe("Zusätzlich nach Zeitraum gruppieren"),
        date_field: z.string().optional().describe("Datumsfeld für period (Standard: Hauptdatum der Sammlung)"),
        filters: z.array(FilterSchema).optional(),
        limit: z.number().int().min(1).max(60).optional().describe("Höchstens so viele Gruppen (Standard 24, Rest wird zusammengefasst)"),
      }),
      kind: "read",
      run(input, ctx) {
        const def = defOf(env, input.collection);
        const v = ctx.vault;
        if (input.metric !== "count" && !input.field) throw new AtlasToolError("Für sum/avg/min/max bitte field angeben (z. B. grossCents).");
        const used = [input.field, input.group_by, ...(input.filters ?? []).map((f) => f.field)];
        assertFieldsVisible(def.id, used, hidesRates(env, ctx));
        assertRefsVisible(def, (input.filters ?? []).map((f) => f.field), visibleIn(env), { namesOnly: true });
        assertRefsVisible(def, [input.group_by], visibleIn(env));
        const rows = applyFilters(def, recordsOf(v, def, ctx.profileId), input.filters, v);
        const result = aggregate(def, rows, v, { metric: input.metric, field: input.field, groupBy: input.group_by, period: input.period, dateField: input.date_field });
        const limit = input.limit ?? 24;
        let shown = result;
        let rest: { value: number; count: number } | undefined;
        if (result.length > limit && !input.period) {
          shown = result.slice(0, limit);
          const tail = result.slice(limit);
          rest = { value: tail.reduce((s, x) => s + x.value, 0), count: tail.reduce((s, x) => s + x.count, 0) };
        } else if (result.length > 120) shown = result.slice(0, 120);
        const money = !!input.field && /Cents$/.test(input.field) && input.metric !== "count";
        const fmt = (n: number) => (money ? { value_eur: eur(Math.round(n)) } : {});
        const total = input.metric === "sum" || input.metric === "count" ? result.reduce((s, x) => s + x.value, 0) : undefined;
        return {
          summary: `${def.label} ausgewertet${input.group_by ? ` nach ${input.group_by}` : ""}${input.period ? ` je ${input.period === "month" ? "Monat" : input.period === "quarter" ? "Quartal" : "Jahr"}` : ""} (${rows.length} Datensätze)`,
          data: {
            collection: def.id,
            metric: input.metric,
            field: input.field,
            records: rows.length,
            rows: shown.map((r) => ({ ...(r.period ? { period: r.period, periodLabel: periodLabel(r.period) } : {}), ...(r.group !== undefined ? { group: r.group } : {}), value: r.value, ...fmt(r.value), count: r.count })),
            ...(rest ? { others: { value: rest.value, ...fmt(rest.value), count: rest.count } } : {}),
            ...(total !== undefined ? { total, ...(money ? { total_eur: eur(Math.round(total)) } : {}) } : {}),
          },
        };
      },
    }),
  );

  if (env.modules.includes("projekte") && env.defs.some((d) => d.id === "projects")) {
    tools.push(
      defineTool({
        name: "project_status",
        description:
          "Stand eines Projekts (oder aller laufenden Projekte, wenn keins genannt ist): Aufgaben erledigt/offen/überfällig, erfasste Stunden gegen Budget, Kosten, verrechenbarer Wert, verrechnet, nächster Meilenstein. Nutze das für Fragen wie \"Wie steht das Projekt X?\" oder \"Welche Projekte laufen aus dem Ruder?\".",
        input: z.object({ project: z.string().optional().describe("id, Nummer oder Name; leer = alle laufenden Projekte") }),
        kind: "read",
        area: "projects",
        atlasArea: "projects",
        run(input, ctx) {
          const v = ctx.vault;
          const def = COLLECTION_BY_ID.get("projects")!;
          if (input.project) {
            const p = resolveRecord(v, def, ctx.profileId, input.project);
            const f = figuresFor(env, ctx, projectFigures(v, p.id, ctx.today));
            return { summary: `Stand von ${f.name}`, data: withEur(f), link: { to: `/projekte/${p.id}`, label: f.name } };
          }
          const list = recordsOf(v, def, ctx.profileId).filter((p) => p.status === "active" || p.status === "planning" || p.status === "on_hold");
          const rows = list.slice(0, 20).map((p) => {
            const f = projectFigures(v, p.id, ctx.today);
            return withEur(figuresFor(env, ctx, { id: f.id, name: f.name, status: f.status, customerName: f.customerName, progressPct: f.progressPct, overdueTasks: f.tasks.overdue, hoursLogged: f.hoursLogged, budgetHours: f.budgetHours, hoursUsedPct: f.hoursUsedPct, costUsedPct: f.costUsedPct, endDate: f.endDate, endDatePassed: f.endDatePassed }));
          });
          return { summary: `${list.length} laufende Projekte`, data: { total: list.length, projects: rows } };
        },
      }),
    );
  }

  if (env.modules.includes("summa") && atLeast(env.level("taxes"), "read")) {
    tools.push(
      defineTool({
        name: "tax_overview",
        description:
          "Steuerzahlen aus der Buchhaltung des aktiven Profils: UVA (Umsatzsteuervoranmeldung, Zahllast und Kennzahlen eines Monats/Quartals), E1a (Einnahmen-Ausgaben-Rechnung, Gewinn und geschätzte Einkommensteuer eines Jahres) oder L1 (Arbeitnehmerveranlagung, Werbungskosten und geschätzte Gutschrift). auto wählt passend zum Profil. Ergebnisse sind Schätzungen aus den erfassten Buchungen.",
        input: z.object({
          kind: z.enum(["auto", "uva", "e1a", "l1"]).optional().describe("Standard auto"),
          year: z.number().int().optional().describe("Jahr, Standard: aktuelles Jahr"),
          period: z.number().int().optional().describe("Nur UVA: Monat 1–12 bzw. Quartal 1–4; Standard: aktueller Zeitraum"),
        }),
        kind: "read",
        area: "summa",
        atlasArea: "taxes",
        run(input, ctx) {
          const v = ctx.vault;
          const p = ctx.profile;
          const year = input.year ?? Number(ctx.today.slice(0, 4));
          const txs = v.transactions.filter((t) => !t.deletedAt && t.profileId === p.id);
          const cats = v.categories.filter((c) => !c.deletedAt);
          let kind = input.kind ?? "auto";
          if (kind === "auto") kind = p.mode === "employee" ? "l1" : p.uvaPeriod !== "none" && p.vatRegime === "regelbesteuerung" && !input.year ? "uva" : "e1a";
          if (kind === "uva") {
            if (p.uvaPeriod === "none") throw new AtlasToolError("Für dieses Profil ist keine UVA eingestellt (Kleinunternehmer oder privat).");
            const cur = periodForDate(ctx.today, p.uvaPeriod);
            const ref = { year: input.year ?? cur.year, index: input.period ?? cur.index, kind: p.uvaPeriod };
            const r = computeUva(p, ref, txs, cats);
            return {
              summary: `UVA ${r.period.label}: ${r.totals.zahllast >= 0 ? "Zahllast" : "Gutschrift"} ${eur(Math.abs(r.totals.zahllast))}`,
              data: {
                kind: "UVA",
                period: r.period.label,
                from: r.period.from,
                to: r.period.to,
                dueDate: uvaPeriodRange(ref).dueDate,
                zahllastCents: r.totals.zahllast,
                zahllast_eur: eur(r.totals.zahllast),
                umsatzsteuer_eur: eur(r.totals.umsatzsteuer),
                vorsteuer_eur: eur(r.totals.vorsteuer),
                lines: r.lines.filter((l) => l.baseCents || l.taxCents).slice(0, 30).map((l) => ({ kz: l.kz, label: l.label, ...(l.baseCents ? { base_eur: eur(l.baseCents) } : {}), ...(l.taxCents ? { tax_eur: eur(l.taxCents) } : {}) })),
                info: r.info,
                warnings: r.warnings,
              },
              link: { to: "/steuern", label: "Steuern öffnen" },
            };
          }
          if (kind === "e1a") {
            const assets = v.assets.filter((a) => !a.deletedAt && a.profileId === p.id);
            const r = computeE1a(p, year, txs, cats, assets);
            return {
              summary: `E1a ${year}: Gewinn ${eur(r.gewinnCents)}`,
              data: {
                kind: "E1a",
                year,
                einnahmen_eur: eur(r.einnahmenCents),
                ausgaben_eur: eur(r.ausgabenCents),
                gewinnVorFreibetrag_eur: eur(r.gewinnVorFreibetragCents),
                grundfreibetrag_eur: eur(r.grundfreibetragCents),
                gewinnCents: r.gewinnCents,
                gewinn_eur: eur(r.gewinnCents),
                geschaetzteEinkommensteuer_eur: eur(r.estSchaetzungCents),
                lines: r.lines.filter((l) => l.amountCents).slice(0, 30).map((l) => ({ kz: l.kz, label: l.label, amount_eur: eur(l.amountCents) })),
                info: r.info,
                warnings: r.warnings,
              },
              link: { to: "/steuern", label: "Steuern öffnen" },
            };
          }
          const r = computeL1(p, year, txs, cats, v.settings.employee[p.id]);
          return {
            summary: `L1 ${year}: geschätzte Gutschrift ${eur(r.estimatedRefundCents)}`,
            data: {
              kind: "L1",
              year,
              werbungskosten_eur: eur(r.werbungskostenCents),
              sonderausgaben_eur: eur(r.sonderausgabenCents),
              geschaetzteGutschrift_eur: eur(r.estimatedRefundCents),
              grenzsteuersatz: r.marginalRate,
              lines: r.lines.filter((l) => l.amountCents).slice(0, 30).map((l) => ({ kz: l.kz, label: l.label, amount_eur: eur(l.amountCents), note: l.note })),
              info: r.info,
              warnings: r.warnings,
            },
            link: { to: "/steuern", label: "Steuern öffnen" },
          };
        },
      }),
    );
  }

  if (env.modules.includes("produkte") && env.defs.some((d) => d.id === "products")) {
    tools.push(
      defineTool({
        name: "stock_status",
        description: "Lagerstand: Bestand je Produkt (Summe der Lagerbewegungen), Mindestbestand, Lagerwert zu Einstandspreisen und was nachbestellt werden sollte.",
        input: z.object({
          only_low: z.boolean().optional().describe("Nur Produkte unter Mindestbestand"),
          query: z.string().optional().describe("Nur Produkte, deren Name/Artikelnummer das enthält"),
        }),
        kind: "read",
        area: "products",
        atlasArea: "products",
        run(input, ctx) {
          const v = ctx.vault;
          const def = COLLECTION_BY_ID.get("products")!;
          const words = input.query ? searchWords(input.query) : [];
          let items = recordsOf(v, def, ctx.profileId)
            .filter((p) => p.trackStock && p.active !== false && (!words.length || matches(def, p, v, words)))
            .map((p) => {
              const onHand = stockOnHand(v, p.id);
              const cost = (p.costCents as number) || 0;
              const min = (p.minStock as number) || 0;
              return { id: p.id, sku: p.sku, name: p.name, unit: p.unit, onHand, minStock: min, low: min > 0 && onHand < min, valueCents: Math.round(onHand * cost) };
            });
          const totalValue = items.reduce((s, x) => s + Math.max(0, x.valueCents), 0);
          const low = items.filter((x) => x.low).length;
          if (input.only_low) items = items.filter((x) => x.low);
          items.sort((a, b) => Number(b.low) - Number(a.low) || b.valueCents - a.valueCents);
          return {
            summary: `${items.length} Lagerartikel, ${low} unter Mindestbestand`,
            data: { totals: { products: items.length, low, valueCents: totalValue, value_eur: eur(totalValue) }, items: items.slice(0, 40).map((x) => ({ ...x, value_eur: eur(x.valueCents) })) },
          };
        },
      }),
    );
  }

  return tools;
}

/**
 * Project figures without what Atlas may not see: internal wage costs only for those who run projects (write access)
 * and only while the team area is open; hours, bookings, invoices and the customer only when their areas are open.
 */
function figuresFor<T extends object>(env: ToolEnv, ctx: AtlasToolContext, f: T): T {
  const out = { ...f } as Record<string, unknown>;
  const drop = (...keys: string[]) => keys.forEach((k) => delete out[k]);
  const see = visibleIn(env);
  if (!ctx.can("projects", "write") || !atLeast(env.level("team"), "read")) drop("timeCostCents", "costUsedPct");
  if (!see("timeEntries")) drop("hoursLogged", "hoursUsedPct", "billableValueCents", "timeCostCents", "costUsedPct");
  if (!see("transactions")) drop("expensesNetCents", "incomeNetCents", "costUsedPct");
  if (!see("invoices")) drop("invoicedNetCents");
  if (!see("contacts")) drop("customerName");
  return out as T;
}

function withEur<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = { ...o };
  for (const [k, val] of Object.entries(o)) if (typeof val === "number" && /Cents$/.test(k)) out[`${k}_eur`] = eur(val);
  return out as T;
}

/** Short summary of what hangs on a record (for get_record). */
function related(env: ToolEnv, def: CollectionDef, r: Rec, ctx: AtlasToolContext): Record<string, unknown> | undefined {
  const v: Vault = ctx.vault;
  const live = <T extends { deletedAt?: string; profileId?: string }>(xs: T[]) => xs.filter((x) => !x.deletedAt && (!x.profileId || x.profileId === ctx.profileId));
  const has = (id: string) => env.defs.some((d) => d.id === id);
  switch (def.id) {
    case "contacts": {
      const out: Record<string, unknown> = {};
      if (has("invoices")) {
        const inv = live(v.invoices).filter((i) => i.customerId === r.id);
        const openDef = COLLECTION_BY_ID.get("invoices")!;
        const open = inv.reduce((s, i) => s + ((openDef.virtual!.openCents!(i as unknown as Rec, v) as number) || 0), 0);
        out.invoices = { count: inv.length, open_eur: eur(open) };
      }
      if (has("transactions")) {
        const tx = live(v.transactions).filter((t) => t.contactId === r.id);
        out.transactions = { count: tx.length, income_eur: eur(tx.filter((t) => t.kind === "income").reduce((s, t) => s + t.grossCents, 0)), expense_eur: eur(tx.filter((t) => t.kind === "expense").reduce((s, t) => s + t.grossCents, 0)) };
      }
      if (has("projects")) out.projects = live(v.projects).filter((p) => p.customerId === r.id).map((p) => ({ id: p.id, name: p.name, status: p.status }));
      if (has("offers")) out.offers = live(v.offers).filter((o) => o.customerId === r.id).map((o) => ({ id: o.id, number: o.number, status: o.status }));
      return out;
    }
    case "projects":
      return withEur(figuresFor(env, ctx, projectFigures(v, r.id, ctx.today)) as unknown as Record<string, unknown>);
    case "tasks": {
      const kids = live(v.tasks).filter((t) => t.parentId === r.id);
      const minutes = live(v.timeEntries).filter((e) => e.taskId === r.id).reduce((s, e) => s + e.minutes, 0);
      return { subtasks: { total: kids.length, done: kids.filter((k) => k.status === "done").length }, ...(has("timeEntries") ? { hoursLogged: Math.round((minutes / 60) * 10) / 10 } : {}) };
    }
    case "products": {
      const moves = live(v.stockMoves).filter((m) => m.productId === r.id).sort((a, b) => b.date.localeCompare(a.date));
      const onHand = stockOnHand(v, r.id);
      return { onHand, stockValue_eur: eur(Math.round(onHand * ((r.costCents as number) || 0))), lastMoves: moves.slice(0, 5).map((m) => ({ date: m.date, quantity: m.quantity, kind: m.kind })), usedIn: live(v.products).filter((p) => p.components.some((c) => c.productId === r.id)).map((p) => p.name) };
    }
    case "workOrders": {
      const steps = (r.steps as { name: string; done: boolean; plannedMinutes: number; actualMinutes: number }[]) ?? [];
      return { product: has("products") ? v.products.find((p) => p.id === r.productId)?.name : undefined, steps: steps.map((s) => ({ name: s.name, done: s.done, plannedMinutes: s.plannedMinutes, actualMinutes: s.actualMinutes })) };
    }
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Visual tools                                                        */
/* ------------------------------------------------------------------ */

export function visualTools(env: ToolEnv): AtlasTool[] {
  return [
    defineTool({
      name: "show_chart",
      description:
        "Zeigt ein Diagramm direkt im Gespräch (Balken, Linie, Fläche, Kreis, gestapelte Balken). Hol die Zahlen vorher mit aggregate o. ä. – erfinde nie Werte. Bei unit eur die Werte in Cent angeben (wie in den Daten). Nutze es, wenn die Person nach einem Diagramm fragt oder eine Entwicklung über Zeit klarer wird.",
      input: z.object({
        kind: z.enum(["bar", "line", "area", "pie", "stacked-bar"]),
        title: z.string(),
        labels: z.array(z.string()).describe("Beschriftungen der x-Achse bzw. Kreisstücke, z. B. Monate oder Kundennamen"),
        series: z.array(z.object({ name: z.string().describe("Name der Reihe, z. B. Einnahmen"), values: z.array(z.number()).describe("Ein Wert pro Beschriftung") })).describe("Eine oder mehrere Reihen; beim Kreis nur eine"),
        unit: z.enum(["eur", "hours", "count", "percent"]),
      }),
      kind: "read",
      run(input) {
        if (!input.labels.length || !input.series.length) throw new AtlasToolError("Diagramm braucht Beschriftungen und mindestens eine Reihe.");
        const bad = input.series.find((s) => s.values.length !== input.labels.length);
        if (bad) throw new AtlasToolError(`Reihe „${bad.name}“ hat ${bad.values.length} Werte, es gibt aber ${input.labels.length} Beschriftungen.`);
        const scale = input.unit === "eur" ? 0.01 : 1;
        const keys = input.series.map((s, i) => (s.name || `Reihe ${i + 1}`).replace(/\./g, " "));
        const data = input.labels.slice(0, 60).map((label, i) => {
          const row: Record<string, string | number> = { label };
          input.series.forEach((s, j) => (row[keys[j]!] = Math.round((s.values[i] ?? 0) * scale * 100) / 100));
          return row;
        });
        const chart: AtlasChartSpec = { kind: input.kind, title: input.title, data, x: "label", series: (input.kind === "pie" ? keys.slice(0, 1) : keys.slice(0, 6)).map((k) => ({ key: k, label: k })), unit: input.unit };
        return { summary: `Diagramm: ${input.title}`, data: { shown: true, note: "Das Diagramm ist für die Person sichtbar – beschreibe kurz, was es zeigt." }, visual: { type: "chart", chart } };
      },
    }),
    defineTool({
      name: "show_table",
      description: "Zeigt eine übersichtliche Tabelle im Gespräch, z. B. eine Liste offener Rechnungen. Werte als fertig formatierter Text (Beträge wie \"1.234,50 €\"). Nicht mehr als 60 Zeilen.",
      input: z.object({ title: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
      kind: "read",
      run(input) {
        if (!input.columns.length) throw new AtlasToolError("Tabelle braucht Spalten.");
        const rows = input.rows.slice(0, 60).map((r) => input.columns.map((_, i) => r[i] ?? ""));
        return { summary: `Tabelle: ${input.title}`, data: { shown: true, rows: rows.length }, visual: { type: "table", title: input.title, columns: input.columns, rows } };
      },
    }),
    defineTool({
      name: "open_page",
      description: `Öffnet eine Seite in Ordo, z. B. /projekte/<id>, /kontakte/<id>, /rechnungen/<id>, /angebote/<id>, /buchungen, /steuern, /zeiten. Nutze das, wenn die Person etwas sehen oder öffnen will. Bekannte Bereiche: ${env.routes.join(", ")}.`,
      input: z.object({ path: z.string().describe("Pfad, beginnt mit /"), label: z.string().describe("Kurze Beschriftung für den Link, z. B. Projekt Website") }),
      kind: "read",
      run(input, ctx) {
        const path = input.path.trim();
        if (!path.startsWith("/") || path.startsWith("//") || /[\s<>"']/.test(path)) throw new AtlasToolError("Bitte einen Pfad innerhalb von Ordo angeben, z. B. /projekte.");
        const base = "/" + (path.split(/[/?#]/)[1] ?? "");
        if (base !== "/" && !env.routes.some((r) => r === base || r.startsWith(base + "/") || base.startsWith(r))) throw new AtlasToolError(`Die Seite ${path} gibt es nicht. Bekannt: ${env.routes.join(", ")}.`);
        ctx.navigate(path);
        return { summary: `${input.label} geöffnet`, data: { opened: path }, visual: { type: "link", to: path, label: input.label } };
      },
    }),
  ];
}
