import { Mail } from "lucide-react";
import { todayIso } from "@ordo/core";
import PostPage from "./PostPage";
import { EmailSettingsTab } from "./EmailSettings";
import type { OrdoModule } from "../types";

export const postModule: OrdoModule = {
  id: "post",
  name: "Post",
  title: "E-Mail & Newsletter",
  tagline: "Rechnungen per Mail, Zahlungserinnerungen und Newsletter – über dein eigenes Brevo-Konto.",
  description:
    "Fertige Rechnungen gehen mit einem Klick samt PDF an den Kunden, überfällige bekommen eine freundliche Zahlungserinnerung, und Kontakte, die zugestimmt haben, deinen Newsletter. Versendet wird über dein eigenes, kostenloses Brevo-Konto – direkt von deinem Gerät, ohne Umweg über uns.",
  features: ["Rechnungen per E-Mail mit PDF", "Zahlungserinnerungen", "Newsletter mit Abmelde-Link", "Eigenes Brevo-Konto (gratis 300 Mails/Tag)"],
  icon: Mail,
  tint: "#0a84ff",
  defaultInstalled: false,
  requires: ["summa"],
  modes: ["business"],
  mobile: true,
  nav: [{ to: "/post", label: "E-Mail", icon: Mail, modes: ["business"] }],
  routes: [{ path: "/post", element: <PostPage /> }],
  settingsTabs: [{ id: "email", label: "E-Mail", element: <EmailSettingsTab /> }],
  badges: ({ vault, profile }): Record<string, number> => {
    // overdue invoices nobody has reminded yet – only once e-mail is set up
    if (vault.settings.email.provider !== "brevo") return {};
    const today = todayIso();
    const n = vault.invoices.filter((i) => !i.deletedAt && i.profileId === profile.id && i.kind === "invoice" && !i.remindedAt && (i.status === "overdue" || (i.status === "sent" && i.dueDate < today))).length;
    return n ? { "/post": n } : {};
  },
};
