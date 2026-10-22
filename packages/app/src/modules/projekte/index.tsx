import { BarChart3, CheckSquare, Clock, FileSignature, FolderKanban, FolderPlus, ListPlus, Timer } from "lucide-react";
import { todayIso } from "@ordo/core";
import OffersPage from "./offers/OffersPage";
import ProjectsPage from "./ProjectsPage";
import ProjectDetail from "./ProjectDetail";
import MyTasksPage from "./MyTasksPage";
import TimesPage from "./TimesPage";
import ReportPage from "./ReportPage";
import { ActiveProjectsWidget, UpcomingWidget, WeekHoursWidget } from "./widgets";
import { ProjectSettingsTab } from "./SettingsTab";
import { seedProjekteDemo } from "./seed";
import type { OrdoModule } from "../types";

export const projekteModule: OrdoModule = {
  id: "projekte",
  name: "Projekte",
  title: "Projekte & Zeiterfassung",
  tagline: "Projekte, Arbeitspakete, Meilensteine, Zeiten und Angebote.",
  description:
    "Plane Projekte mit Arbeitspaketen und Aufgaben, setze Meilensteine, sieh alles im Zeitplan, erfasse Zeiten per Stoppuhr und behalte Budget und Stunden im Blick. Angebote schreibst du direkt im Projekt – angenommene Angebote werden mit einem Klick zur Rechnung in Summa.",
  features: ["Projekte mit Budget und Kunden", "Arbeitspakete & Aufgaben im Baum, Board und Zeitplan", "Meilensteine", "Zeiterfassung mit Stoppuhr", "Auswertung: Prognose, Auslastung, Risiken", "Angebote mit PDF", "Projekt-Export nach Excel"],
  icon: FolderKanban,
  tint: "#5856d6",
  defaultInstalled: false,
  modes: ["business"],
  mobile: true,
  nav: [
    { to: "/projekte", label: "Projekte", icon: FolderKanban, modes: ["business"], mobileRank: 1 },
    { to: "/aufgaben", label: "Meine Aufgaben", short: "Aufgaben", icon: CheckSquare, modes: ["business"], mobileRank: 2 },
    { to: "/zeiten", label: "Zeiterfassung", short: "Zeiten", icon: Timer, modes: ["business"], mobileRank: 2 },
    { to: "/angebote", label: "Angebote", icon: FileSignature, modes: ["business"] },
    { to: "/projekt-auswertung", label: "Auswertung", icon: BarChart3, modes: ["business"] },
  ],
  routes: [
    { path: "/projekte", element: <ProjectsPage /> },
    { path: "/projekte/:id", element: <ProjectDetail /> },
    { path: "/projekte/:id/:tab", element: <ProjectDetail /> },
    { path: "/aufgaben", element: <MyTasksPage /> },
    { path: "/zeiten", element: <TimesPage /> },
    { path: "/angebote", element: <OffersPage /> },
    { path: "/projekt-auswertung", element: <ReportPage /> },
    { path: "/angebote/:id", element: <OffersPage /> },
  ],
  quickActions: [
    { label: "Neues Projekt", icon: FolderPlus, to: "/projekte?neu=1", modes: ["business"] },
    { label: "Zeit erfassen", icon: Clock, to: "/zeiten?neu=1", modes: ["business"] },
    { label: "Neue Aufgabe", icon: ListPlus, to: "/aufgaben?neu=1", modes: ["business"] },
    { label: "Neues Angebot", icon: FileSignature, to: "/angebote?neu=1", modes: ["business"] },
  ],
  dashboardWidgets: [
    { id: "projekte-active", element: <ActiveProjectsWidget />, modes: ["business"] },
    { id: "projekte-week", element: <WeekHoursWidget />, modes: ["business"] },
    { id: "projekte-next", element: <UpcomingWidget />, wide: true, modes: ["business"] },
  ],
  settingsTabs: [{ id: "projekte", label: "Projekte", element: <ProjectSettingsTab /> }],
  badges: ({ vault, profile }) => {
    // overdue tasks for the person on this device (everyone's when there is no team)
    const today = todayIso();
    const me = vault.settings.meMemberId && vault.members.some((m) => m.id === vault.settings.meMemberId && !m.deletedAt) ? vault.settings.meMemberId : undefined;
    const open = new Set(vault.projects.filter((p) => !p.deletedAt && p.profileId === profile.id && p.status !== "completed" && p.status !== "cancelled").map((p) => p.id));
    const parents = new Set(vault.tasks.filter((t) => !t.deletedAt && t.parentId).map((t) => t.parentId));
    const overdue = vault.tasks.filter((t) => !t.deletedAt && open.has(t.projectId) && !parents.has(t.id) && t.status !== "done" && !!t.dueDate && t.dueDate < today && (!me || t.assigneeIds.includes(me))).length;
    return { "/aufgaben": overdue };
  },
  seedDemo: seedProjekteDemo,
  atlasContext:
    "Projekte: projects (status, budgetCents, customerId, startDate/endDate), tasks (Baum über parentId; Aufgaben mit Kindern = Arbeitspakete; status, estimateHours, dueDate, assigneeIds, milestoneId), milestones, timeEntries (minutes, billable, memberId, taskId), offers (Angebote mit lines).",
};
