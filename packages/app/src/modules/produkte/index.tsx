import { ArrowLeftRight, Boxes, PackagePlus, PackageSearch } from "lucide-react";
import { isBelowMinimum, stockLevels } from "@ordo/core";
import ProductsPage from "./ProductsPage";
import ProductDetail from "./ProductDetail";
import StockPage from "./StockPage";
import { StockWidget } from "./widgets";
import { seedProdukteDemo } from "./seed";
import type { OrdoModule } from "../types";

export const produkteModule: OrdoModule = {
  id: "produkte",
  name: "Lager",
  title: "Produkte & Lager",
  tagline: "Artikel, Preise, Lagerbestand und Bestellvorschläge.",
  description:
    "Ein Artikelstamm für Produkte, Material und Leistungen mit Preisen und Steuersätzen – direkt nutzbar in Angeboten und Rechnungen. Lagerbewegungen halten den Bestand aktuell, Mindestbestände melden sich rechtzeitig.",
  features: ["Artikel & Leistungen mit Preisen", "Lagerbestand und -bewegungen", "Mindestbestand & Bestellvorschläge", "Inventur", "Lagerwert"],
  icon: Boxes,
  tint: "#ff9500",
  defaultInstalled: false,
  modes: ["business"],
  mobile: true,
  nav: [
    { to: "/produkte", label: "Produkte", icon: PackageSearch, modes: ["business"] },
    { to: "/lager", label: "Lager", icon: Boxes, modes: ["business"] },
  ],
  routes: [
    { path: "/produkte", element: <ProductsPage /> },
    { path: "/produkte/:id", element: <ProductDetail /> },
    { path: "/lager", element: <StockPage /> },
  ],
  quickActions: [
    { label: "Neues Produkt", icon: PackagePlus, to: "/produkte?neu=1", modes: ["business"] },
    { label: "Lagerbewegung", icon: ArrowLeftRight, to: "/lager?neu=1", modes: ["business"] },
  ],
  dashboardWidgets: [{ id: "lager", element: <StockWidget />, modes: ["business"] }],
  badges: ({ vault, profile }): Record<string, number> => {
    const products = vault.products.filter((p) => !p.deletedAt && p.profileId === profile.id && p.active);
    if (!products.length) return {};
    const levels = stockLevels(products, vault.stockMoves.filter((m) => m.profileId === profile.id));
    return { "/lager": products.filter((p) => isBelowMinimum(p, levels.get(p.id) ?? 0)).length };
  },
  seedDemo: seedProdukteDemo,
  atlasContext: "Lager: products (sku, priceCents netto, costCents, vatRate, trackStock, minStock, components = Stückliste, operations = Arbeitsschritte), stockMoves (quantity +/-, kind, date).",
};
