import { bomCost, ContactSchema, newId, newStockMove, nowIso, ProductSchema, todayIso, type Contact, type Product, type StockMove, type StockMoveDraft, type VaultStore } from "@ordo/core";
import { isoAddDays } from "./shared";

/** Stable references so the Produktion demo can find these articles. */
export const DEMO_REF = {
  paper: "demo:lager:papier-a1",
  card: "demo:lager:karton-sra3",
  ink: "demo:lager:druckfarbe",
  fabric: "demo:lager:banner-stoff",
  cassette: "demo:lager:rollup-kassette",
  design: "demo:lager:designstunde",
  consulting: "demo:lager:beratung",
  poster: "demo:lager:plakat-a1",
  cards: "demo:lager:visitenkarten",
  rollup: "demo:lager:rollup",
} as const;

/**
 * Demo for "Muster Design e.U." – a Viennese design studio that also prints:
 * services, three products with bills of materials and work steps, five materials, suppliers
 * and stock movements over the last eight weeks. The roll-up cassette ends up below its minimum.
 */
export function seedProdukteDemo(store: VaultStore, profileId: string): void {
  if (store.list("products", { profileId }).some((p) => p.legacyRef?.startsWith("demo:lager:"))) return;
  const now = nowIso();
  const today = todayIso();
  const day = (n: number) => isoAddDays(today, n);
  const contacts = store.list("contacts", { profileId });
  const findContact = (part: string) => contacts.find((c) => c.name.toLowerCase().includes(part.toLowerCase()))?.id;

  const vendor = (name: string, extra: Partial<Contact>): Contact => ContactSchema.parse({ id: newId("ctc"), profileId, name, kind: "vendor", createdAt: now, updatedAt: now, ...extra });
  const papyrus = vendor("Papyrus Papierhandel GmbH", { street: "Brunner Straße 59", zip: "1230", city: "Wien", uid: "ATU64512398", email: "bestellung@papyrus-papier.at" });
  const brunner = vendor("Farbenwerk Brunner GmbH", { street: "Industriezeile 12", zip: "4020", city: "Linz", uid: "ATU57821466" });
  const huber = vendor("Display-Systeme Huber KG", { street: "Kärntner Straße 300", zip: "8054", city: "Graz", uid: "ATU69031175" });

  const product = (ref: string, data: Partial<Product> & { name: string }): Product => ProductSchema.parse({ id: newId("prd"), profileId, legacyRef: ref, createdAt: now, updatedAt: now, ...data });
  const paper = product(DEMO_REF.paper, { name: "Papier 300 g A1", sku: "M-1001", kind: "material", unit: "Bogen", costCents: 120, minStock: 100, location: "Regal A1", category: "Papier", supplierId: papyrus.id, description: "Bilderdruckpapier matt, 300 g/m², 594 × 841 mm" });
  const card = product(DEMO_REF.card, { name: "Karton 350 g SRA3", sku: "M-1002", kind: "material", unit: "Bogen", costCents: 45, minStock: 200, location: "Regal A2", category: "Papier", supplierId: papyrus.id, description: "Naturkarton 350 g/m², 320 × 450 mm – 24 Visitenkarten je Bogen" });
  const ink = product(DEMO_REF.ink, { name: "Druckfarbe CMYK", sku: "M-1003", kind: "material", unit: "ml", costCents: 8, minStock: 2000, location: "Druckerraum", category: "Farbe", supplierId: brunner.id, description: "Pigmenttinte für den Großformatdrucker" });
  const fabric = product(DEMO_REF.fabric, { name: "Banner-Stoff 440 g", sku: "M-1004", kind: "material", unit: "m²", costCents: 650, minStock: 20, location: "Rollenlager", category: "Display", supplierId: huber.id, description: "Blockout-Bannerstoff, schwer entflammbar (B1)" });
  const cassette = product(DEMO_REF.cassette, { name: "Roll-up-Kassette 85 × 200", sku: "M-1005", kind: "material", unit: "Stk", costCents: 3800, minStock: 6, location: "Rollenlager", category: "Display", supplierId: huber.id, description: "Aluminium-Kassette mit Tasche" });
  const design = product(DEMO_REF.design, { name: "Designstunde", sku: "L-01", kind: "service", unit: "Std", priceCents: 8500, trackStock: false, category: "Design", description: "Grafikdesign, Layout und Reinzeichnung" });
  const consulting = product(DEMO_REF.consulting, { name: "Beratung", sku: "L-02", kind: "service", unit: "Std", priceCents: 9500, trackStock: false, category: "Beratung", description: "Markenberatung und Konzept" });
  const poster = product(DEMO_REF.poster, {
    name: "Plakat A1",
    sku: "P-2001",
    unit: "Stk",
    priceCents: 2490,
    minStock: 10,
    location: "Fertigware",
    category: "Drucksorten",
    description: "Plakat A1, 4-färbig auf 300 g Bilderdruck matt",
    components: [{ productId: paper.id, quantity: 1 }, { productId: ink.id, quantity: 25 }],
    operations: [
      { id: newId("op"), name: "Druckvorstufe", minutes: 10, workCenter: "Mac-Arbeitsplatz" },
      { id: newId("op"), name: "Druck", minutes: 6, workCenter: "Großformatdrucker" },
      { id: newId("op"), name: "Schneiden", minutes: 2, workCenter: "Schneidetisch" },
    ],
  });
  const cards = product(DEMO_REF.cards, {
    name: "Visitenkarten 500 Stk",
    sku: "P-2002",
    unit: "Pkg",
    priceCents: 4900,
    location: "Fertigware",
    category: "Drucksorten",
    description: "500 Visitenkarten 85 × 55 mm auf 350 g Naturkarton",
    components: [{ productId: card.id, quantity: 21 }, { productId: ink.id, quantity: 15 }],
    operations: [
      { id: newId("op"), name: "Druckvorstufe", minutes: 15, workCenter: "Mac-Arbeitsplatz" },
      { id: newId("op"), name: "Druck", minutes: 12, workCenter: "Digitaldruckmaschine" },
      { id: newId("op"), name: "Schneiden", minutes: 10, workCenter: "Schneidemaschine" },
    ],
  });
  const rollup = product(DEMO_REF.rollup, {
    name: "Roll-up Banner 85 × 200",
    sku: "P-2003",
    unit: "Stk",
    priceCents: 18900,
    minStock: 2,
    location: "Fertigware",
    category: "Display",
    description: "Roll-up mit Kassette und Tasche, Druck auf Blockout-Stoff",
    components: [{ productId: fabric.id, quantity: 1.7 }, { productId: cassette.id, quantity: 1 }, { productId: ink.id, quantity: 60 }],
    operations: [
      { id: newId("op"), name: "Druckvorstufe", minutes: 20, workCenter: "Mac-Arbeitsplatz" },
      { id: newId("op"), name: "Druck", minutes: 25, workCenter: "Großformatdrucker" },
      { id: newId("op"), name: "Schneiden", minutes: 10, workCenter: "Schneidetisch" },
      { id: newId("op"), name: "Montage", minutes: 15, workCenter: "Werkbank" },
    ],
  });

  // production cost from the bill of materials, labour at the team's average hourly cost
  const rates = store.list("members").filter((m) => m.active && m.hourlyCostCents > 0).map((m) => m.hourlyCostCents);
  const hourly = rates.length ? Math.round(rates.reduce((s, c) => s + c, 0) / rates.length) : 3800;
  design.costCents = hourly;
  consulting.costCents = hourly;
  const all = [paper, card, ink, fabric, cassette, design, consulting, poster, cards, rollup];
  for (const p of [poster, cards, rollup]) p.costCents = bomCost(p, all, { hourlyCostCents: hourly }).totalCents;

  const mv = (d: Omit<StockMoveDraft, "note"> & { note?: string }) => newStockMove(profileId, { note: "", ...d }, now);
  const moves: StockMove[] = [
    mv({ productId: paper.id, date: day(-56), quantity: 300, kind: "receipt", unitCostCents: 120, contactId: papyrus.id, note: "Lieferschein 24-1187" }),
    mv({ productId: card.id, date: day(-56), quantity: 500, kind: "receipt", unitCostCents: 45, contactId: papyrus.id, note: "Lieferschein 24-1187" }),
    mv({ productId: ink.id, date: day(-55), quantity: 5000, kind: "receipt", unitCostCents: 8, contactId: brunner.id, note: "5 × 1 l Kartusche" }),
    mv({ productId: fabric.id, date: day(-49), quantity: 30, kind: "receipt", unitCostCents: 650, contactId: huber.id, note: "1 Rolle 1,10 × 27,3 m" }),
    mv({ productId: cassette.id, date: day(-49), quantity: 8, kind: "receipt", unitCostCents: 3800, contactId: huber.id }),
    mv({ productId: poster.id, date: day(-42), quantity: 12, kind: "adjustment", unitCostCents: poster.costCents, note: "Anfangsbestand" }),
    mv({ productId: rollup.id, date: day(-42), quantity: 3, kind: "adjustment", unitCostCents: rollup.costCents, note: "Anfangsbestand" }),
    mv({ productId: paper.id, date: day(-35), quantity: 200, kind: "receipt", unitCostCents: 120, contactId: papyrus.id, note: "Nachlieferung" }),
    mv({ productId: cassette.id, date: day(-28), quantity: -3, kind: "sale", unitCostCents: 3800, contactId: findContact("Café Morgenrot"), note: "Ersatzkassetten" }),
    mv({ productId: paper.id, date: day(-21), quantity: -15, kind: "issue", unitCostCents: 120, note: "Probedrucke Farbabstimmung" }),
    mv({ productId: poster.id, date: day(-20), quantity: -8, kind: "sale", unitCostCents: poster.costCents, contactId: findContact("Alpenblick"), note: "Plakate Sommerfest" }),
    mv({ productId: rollup.id, date: day(-18), quantity: -1, kind: "sale", unitCostCents: rollup.costCents, contactId: findContact("Stadtwerke"), note: "Messe-Roll-up" }),
    mv({ productId: ink.id, date: day(-14), quantity: -300, kind: "issue", unitCostCents: 8, note: "Kalibrierung und Düsenreinigung" }),
    mv({ productId: paper.id, date: day(-7), quantity: -2, kind: "count", unitCostCents: 120, note: "Inventur: 2 Bogen beschädigt" }),
  ];

  store.mutate(
    (v) => {
      v.contacts = [...v.contacts, papyrus, brunner, huber];
      v.products = [...v.products, ...all];
      v.stockMoves = [...v.stockMoves, ...moves];
    },
    { audit: { action: "demo.seed", entity: "products", details: "Produkte & Lager" } },
  );
}
