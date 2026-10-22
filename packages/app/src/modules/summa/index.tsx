import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, BarChart3, FilePlus2, Landmark, Package, ReceiptText, Scale } from "lucide-react";
import { documentDirection } from "@ordo/core";
import { SummaMark } from "@/components/Logo";
import Documents from "@/pages/Documents";
import Transactions from "@/pages/Transactions";
import Invoices from "@/pages/Invoices";
import Assets from "@/pages/Assets";
import Taxes from "@/pages/Taxes";
import Reports from "@/pages/Reports";
import Bank from "@/pages/Bank";
import type { OrdoModule } from "../types";

export const summaModule: OrdoModule = {
  id: "summa",
  name: "Summa",
  title: "Buchhaltung",
  tagline: "Rechnungen rein, Steuern raus – Summa bucht von selbst.",
  description:
    "Summa liest eingehende Rechnungen und Kassenbons aus deinen Ordnern, bucht Eindeutiges von allein und rechnet laufend Umsatzsteuer-Voranmeldung, Gewinn (E1a) oder Arbeitnehmerveranlagung mit. Dazu Kontoauszüge, Analysen und Rechnungen an Kunden.",
  features: ["Eingehende und ausgehende Rechnungen", "Automatisches Buchen mit KI", "UVA, E1a, L1 fertig für FinanzOnline", "Kontoauszüge abgleichen", "Anlagen & Abschreibung"],
  icon: SummaMark,
  tint: "#0f9d8a",
  defaultInstalled: true,
  mobile: true,
  nav: [
    { to: "/belege", label: "Eingehende Rechnungen", labelFor: { employee: "Rechnungen & Bons" }, short: "Eingang", icon: ArrowDownToLine, mobileRank: 1 },
    { to: "/rechnungen", label: "Ausgehende Rechnungen", short: "Ausgang", icon: ArrowUpFromLine, modes: ["business"], mobileRank: 3 },
    { to: "/buchungen", label: "Einnahmen & Ausgaben", short: "Buchungen", icon: ArrowLeftRight, mobileRank: 2 },
    { to: "/steuern", label: "Steuern", icon: Scale, mobileRank: 4 },
    { to: "/analysen", label: "Analysen", icon: BarChart3, mobileRank: 5 },
    { to: "/bank", label: "Kontoauszüge", icon: Landmark, secondary: true },
    { to: "/anlagen", label: "Anlagen & Abschreibung", icon: Package, modes: ["business"], secondary: true },
  ],
  routes: [
    { path: "/belege", element: <Documents /> },
    { path: "/belege/:id", element: <Documents /> },
    { path: "/buchungen", element: <Transactions /> },
    { path: "/bank", element: <Bank /> },
    { path: "/rechnungen", element: <Invoices /> },
    { path: "/rechnungen/:id", element: <Invoices /> },
    { path: "/anlagen", element: <Assets /> },
    { path: "/steuern", element: <Taxes /> },
    { path: "/steuern/:tab", element: <Taxes /> },
    { path: "/analysen", element: <Reports /> },
  ],
  quickActions: [
    { label: "Buchung von Hand", icon: ReceiptText, to: "/buchungen?neu=1" },
    { label: "Rechnung schreiben", icon: FilePlus2, to: "/rechnungen/neu", modes: ["business"] },
  ],
  badges: ({ vault, profile }): Record<string, number> => {
    const docs = vault.documents.filter((d) => !d.deletedAt && d.profileId === profile.id && d.status === "review");
    // bank lines nobody has looked at yet (no booking, or a suggestion waiting for a yes)
    const bank = vault.bankLines.filter((l) => !l.deletedAt && l.profileId === profile.id && (l.status === "unmatched" || l.status === "suggested")).length;
    if (profile.mode !== "business") return { "/belege": docs.length, "/bank": bank };
    const txById = new Map(vault.transactions.map((t) => [t.id, t]));
    const outgoing = docs.filter((d) => documentDirection(d, d.transactionId ? txById.get(d.transactionId) : undefined) === "outgoing").length;
    return { "/belege": docs.length - outgoing, "/rechnungen": outgoing, "/bank": bank };
  },
  atlasContext:
    "Summa (Buchhaltung): transactions = Einnahmen/Ausgaben (grossCents, vatLines, categoryId, date), documents = eingelesene Rechnungen/Bons, invoices = Rechnungen an Kunden, categories, bankLines = Kontoauszugszeilen, assets = Anlagen.",
};
