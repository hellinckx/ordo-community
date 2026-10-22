import { Factory, ListTree } from "lucide-react";
import { isWorkOrderOpen, todayIso } from "@ordo/core";
import WorkOrdersPage from "./WorkOrdersPage";
import WorkOrderDetail from "./WorkOrderDetail";
import BomPage from "./BomPage";
import { ProductionWidget } from "./widgets";
import { ProductionSettingsTab } from "./SettingsTab";
import { seedProduktionDemo } from "./seed";
import type { OrdoModule } from "../types";

export const produktionModule: OrdoModule = {
  id: "produktion",
  name: "Produktion",
  title: "Produktion",
  tagline: "Stücklisten, Fertigungsaufträge und Arbeitsschritte im Team.",
  description:
    "Lege fest, woraus ein Produkt besteht und welche Arbeitsschritte nötig sind. Fertigungsaufträge planen Material und Zeit, das Team hakt Schritte ab, und fertige Ware landet automatisch im Lager.",
  features: ["Stücklisten & Arbeitspläne", "Fertigungsaufträge mit Status", "Materialbedarf & Verfügbarkeit", "Arbeitsschritte pro Mitarbeiter:in", "Fertigware ins Lager buchen"],
  icon: Factory,
  tint: "#ff3b30",
  defaultInstalled: false,
  requires: ["produkte"],
  modes: ["business"],
  mobile: true,
  nav: [
    { to: "/produktion", label: "Fertigungsaufträge", short: "Fertigung", icon: Factory, modes: ["business"] },
    { to: "/stuecklisten", label: "Stücklisten", icon: ListTree, modes: ["business"] },
  ],
  routes: [
    { path: "/produktion", element: <WorkOrdersPage /> },
    { path: "/produktion/:id", element: <WorkOrderDetail /> },
    { path: "/stuecklisten", element: <BomPage /> },
  ],
  quickActions: [{ label: "Fertigungsauftrag", icon: Factory, to: "/produktion?neu=1", modes: ["business"] }],
  dashboardWidgets: [{ id: "produktion", element: <ProductionWidget />, modes: ["business"] }],
  settingsTabs: [{ id: "fertigung", label: "Fertigung", element: <ProductionSettingsTab /> }],
  badges: ({ vault, profile }): Record<string, number> => {
    const today = todayIso();
    const overdue = vault.workOrders.filter((w) => w.profileId === profile.id && isWorkOrderOpen(w) && !!w.dueDate && w.dueDate < today).length;
    return overdue ? { "/produktion": overdue } : {};
  },
  seedDemo: seedProduktionDemo,
  atlasContext: "Produktion: workOrders (productId, quantity, status, steps mit plannedMinutes/actualMinutes/done, dueDate), Stücklisten stehen in products.components.",
};
