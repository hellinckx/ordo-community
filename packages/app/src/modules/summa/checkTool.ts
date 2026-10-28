import { z } from "zod";
import { runAllCheck } from "@ordo/core";
import { defineTool } from "@/atlas/tools";
import { atLeast, effectiveLevel, type AtlasArea } from "@/atlas/areas";

/** "Atlas, check alles": the rules of the Alles-Check, read-only – what Atlas then fixes goes through the usual tools. */
export const allCheckTool = defineTool({
  name: "run_all_check",
  description:
    "Führt den Alles-Check aus: feste Regeln über die Buchhaltung des Profils – Ausgaben ohne Rechnung (Fehler: nicht absetzbar, keine Vorsteuer), Beträge, die nicht zusammenpassen, Buchungen ohne Kategorie, ungeprüfte Buchungen, mögliche Doppelbuchungen, Einnahmen ohne Rechnung, überfällige Rechnungen, offene Kontobewegungen, wartende oder unlesbare Dateien, Projekte über dem Enddatum. Liefert die Befunde mit den betroffenen ids. Nimm das, wenn die Person alles prüfen lassen will; erklär danach die Fehler zuerst und biete an, was du davon erledigen kannst.",
  input: z.object({}),
  kind: "read",
  area: "summa",
  atlasArea: "bookkeeping",
  preview: () => "Alles-Check",
  run(_i, ctx) {
    // only what Atlas and the person's role may read: locked areas are left out, contact names too
    const a = ctx.store.vault.settings.atlas;
    const may = (area: AtlasArea) => atLeast(effectiveLevel({ role: ctx.role, permission: a.permission, areas: a.areas }, area), "read");
    const r = runAllCheck(ctx.store.vault, ctx.profileId, ctx.today, { bookings: may("bookkeeping"), outgoing: may("outgoing"), incoming: may("incoming"), bank: may("bank"), projects: may("projects"), contacts: may("contacts") });
    return {
      summary: r.findings.length ? `Alles-Check: ${r.errors} Fehler, ${r.warnings} zu prüfen` : "Alles-Check: alles in Ordnung",
      data: { errors: r.errors, warnings: r.warnings, findings: r.findings.map((f) => ({ level: f.level, title: f.title, detail: f.detail, page: f.link, ids: (f.ids ?? []).slice(0, 40) })) },
      link: { to: "/pruefung", label: "Alles-Check öffnen" },
    };
  },
});
