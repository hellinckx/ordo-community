import type { Category, Contact, ExtractedFields, Mode } from "../model/types";
import { FALLBACK_CATEGORY } from "../model/defaults";

export interface Suggestion {
  categoryId: string | undefined;
  categoryScore: number;
  contactId: string | undefined;
  contactScore: number;
  reasons: string[];
}

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchContact(fields: ExtractedFields, contacts: Contact[]): { contact: Contact; score: number } | null {
  const outgoing = fields.direction === "outgoing";
  const uid = outgoing ? undefined : fields.vendorUid?.replace(/\s+/g, "").toUpperCase();
  const iban = outgoing ? undefined : fields.vendorIban?.replace(/\s+/g, "").toUpperCase();
  const name = norm(outgoing ? fields.customerName : fields.vendorName);
  let best: { contact: Contact; score: number } | null = null;
  for (const c of contacts) {
    if (c.deletedAt) continue;
    let score = 0;
    if (uid && c.uid && c.uid.replace(/\s+/g, "").toUpperCase() === uid) score = 1;
    else if (iban && c.iban && c.iban.replace(/\s+/g, "").toUpperCase() === iban) score = 0.95;
    else if (name) {
      const cn = norm(c.name);
      if (cn && (cn === name || name.includes(cn) || cn.includes(name))) score = 0.85;
      else if (c.aliases.some((a) => norm(a) && name.includes(norm(a)))) score = 0.8;
      else {
        const tokens = cn.split(" ").filter((t) => t.length > 3);
        const hits = tokens.filter((t) => name.includes(t)).length;
        if (tokens.length && hits / tokens.length >= 0.6) score = 0.6;
      }
    }
    if (score > (best?.score ?? 0)) best = { contact: c, score };
  }
  return best;
}

export function suggestCategory(fields: ExtractedFields, text: string, categories: Category[], contacts: Contact[], mode: Mode, kind: "income" | "expense"): Suggestion {
  const reasons: string[] = [];
  const cats = categories.filter((c) => !c.deletedAt && !c.isArchived && c.kind === kind && (c.mode === "both" || c.mode === mode));
  const contact = matchContact(fields, contacts);
  let categoryId: string | undefined;
  let categoryScore = 0;

  if (contact && contact.score >= 0.8 && contact.contact.defaultCategoryId && cats.some((c) => c.id === contact.contact.defaultCategoryId)) {
    categoryId = contact.contact.defaultCategoryId;
    categoryScore = 0.9;
    reasons.push(`Kontakt „${contact.contact.name}“ erkannt → Standardkategorie`);
  }

  if (!categoryId && fields.suggestedCategory) {
    const want = norm(fields.suggestedCategory);
    const hit = cats.find((c) => norm(c.name) === want) ?? cats.find((c) => norm(c.name).includes(want) || want.includes(norm(c.name).split(" ")[0] ?? "§"));
    if (hit) {
      categoryId = hit.id;
      categoryScore = 0.8;
      reasons.push(`KI-Vorschlag „${fields.suggestedCategory}“`);
    }
  }

  if (!categoryId) {
    const hay = norm([fields.vendorName, fields.description, text.slice(0, 3000)].filter(Boolean).join(" "));
    const vendorHay = norm(fields.vendorName);
    let best: { cat: Category; score: number; kw: string } | null = null;
    for (const c of cats) {
      for (const kw of [...c.keywords, ...c.userKeywords]) {
        const k = norm(kw);
        if (!k) continue;
        let score = 0;
        if (vendorHay && vendorHay.includes(k)) score = 0.75 + Math.min(0.2, k.length / 50);
        else if (hay.includes(` ${k} `) || hay.startsWith(k + " ") || hay.endsWith(" " + k) || hay === k) score = 0.45 + Math.min(0.2, k.length / 50);
        else if (k.length >= 5 && hay.includes(k)) score = 0.4;
        if (score > (best?.score ?? 0)) best = { cat: c, score, kw };
      }
    }
    if (best) {
      categoryId = best.cat.id;
      categoryScore = best.score;
      reasons.push(`Stichwort „${best.kw}“`);
    }
  }

  if (!categoryId) {
    categoryId = FALLBACK_CATEGORY[mode][kind];
    categoryScore = 0.2;
    reasons.push("Keine Zuordnung – Standardkategorie");
  }

  return { categoryId, categoryScore, contactId: contact && contact.score >= 0.6 ? contact.contact.id : undefined, contactScore: contact?.score ?? 0, reasons };
}
