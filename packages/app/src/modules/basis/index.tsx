import { Contact2, Download, FolderOpen, LayoutGrid, Sparkles, Upload, UserPlus, Users } from "lucide-react";
import { Logo } from "@/components/Logo";
import AtlasPage from "@/atlas/AtlasPage";
import { AtlasSettings } from "@/atlas/AtlasSettings";
import TeamPage from "./team/TeamPage";
import FilesPage from "./files/FilesPage";
import { IntegrationsTab } from "./integrations/IntegrationsTab";
import Dashboard from "@/pages/Dashboard";
import Contacts from "@/pages/Contacts";
import Exports from "@/pages/Exports";
import { seedBasisDemo } from "./seed";
import type { OrdoModule } from "../types";

/** Ordo Basis: what every workspace has – overview, Atlas, contacts, files, team, export. */
export const basisModule: OrdoModule = {
  id: "basis",
  name: "Ordo",
  title: "Basis",
  tagline: "Übersicht, Atlas, Kontakte, Dateien und Team – immer dabei.",
  description: "Das Fundament: eine Übersicht über alles, Atlas als KI-Assistent mit Zugriff auf alle Bereiche, gemeinsame Kontakte für Kunden und Lieferanten, eine Dateiablage mit Ordnern und das Team mit Rollen und Rechten.",
  features: ["Übersicht mit allen Modulen", "Atlas – KI-Assistent", "Kontakte mit Ansprechpartnern", "Dateiablage", "Team, Rollen & Rechte", "Export & Sicherung"],
  icon: Logo,
  tint: "#0a5fe0",
  defaultInstalled: true,
  required: true,
  mobile: true,
  nav: [
    { to: "/", label: "Übersicht", icon: LayoutGrid, mobileRank: 0 },
    { to: "/atlas", label: "Atlas", icon: Sparkles },
    { to: "/kontakte", label: "Kontakte", icon: Contact2, secondary: true },
    { to: "/dateien", label: "Dateien", icon: FolderOpen, advanced: true },
    { to: "/team", label: "Team", icon: Users, advanced: true },
    { to: "/export", label: "Export & Sicherung", icon: Download, secondary: true },
  ],
  routes: [
    { path: "/", element: <Dashboard /> },
    { path: "/atlas", element: <AtlasPage /> },
    { path: "/atlas/:chatId", element: <AtlasPage /> },
    { path: "/kontakte", element: <Contacts /> },
    { path: "/kontakte/:id", element: <Contacts /> },
    { path: "/dateien", element: <FilesPage /> },
    { path: "/team", element: <TeamPage /> },
    { path: "/export", element: <Exports /> },
  ],
  quickActions: [
    { label: "Kontakt", icon: UserPlus, to: "/kontakte?neu=1" },
    { label: "Datei hochladen", icon: Upload, to: "/dateien?neu=1" },
  ],
  settingsTabs: [
    { id: "atlas", label: "Atlas", element: <AtlasSettings /> },
    { id: "schnittstellen", label: "Schnittstellen", element: <IntegrationsTab /> },
  ],
  seedDemo: seedBasisDemo,
  atlasContext: "Basis: contacts = Kunden/Lieferanten (mit persons = Ansprechpartner), members = Team mit Rolle und Stundensätzen, folders/files = Dateiablage.",
};
