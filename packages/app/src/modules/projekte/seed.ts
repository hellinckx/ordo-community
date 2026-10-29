import {
  addWorkdaysIso,
  autoSchedule,
  formatNumber,
  ids,
  isWeekendIso,
  mondayOfIso,
  nowIso,
  shiftIsoDate,
  timeEntryRates,
  todayIso,
  type Contact,
  type Member,
  type Milestone,
  type Priority,
  type Project,
  type Task,
  type TaskStatus,
  type TimeEntry,
  type VaultStore,
} from "@ordo/core";

interface Spec {
  title: string;
  est?: number;
  who?: string[];
  prio?: Priority;
  desc?: string;
  children?: Spec[];
}

interface ProjectSpec {
  key: string;
  name: string;
  customer?: Contact;
  status: Project["status"];
  start: string;
  hoursPerDay: number;
  budgetCents: number;
  budgetHours: number;
  billing: Project["billing"];
  rateCents: number;
  manager?: string;
  description: string;
  tasks: Spec[];
  milestones: { title: string; links: string[]; desc?: string; invoiceCents?: number }[];
  /** Override statuses by task title. */
  statusOverride?: Record<string, TaskStatus>;
  /** Factor on the estimate for booked time per task title (done tasks). */
  effort?: Record<string, number>;
}

/** Deterministic pseudo random numbers, so the demo looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const NOTES: Record<string, string[]> = {
  default: ["Umsetzung", "Abstimmung und Umsetzung", "Weiterarbeit", "Korrekturen eingearbeitet", "Ausarbeitung"],
};

/**
 * Demo content for "Muster Design e.U.": three projects (website relaunch, corporate design – completed,
 * trade fair stand – in planning) with work packages, milestones and six weeks of time entries.
 */
export function seedProjekteDemo(store: VaultStore, profileId: string): void {
  const v = store.vault;
  const now = nowIso();
  const today = todayIso();
  const random = rng(20261021);

  /* team: the Basis module seeds it – only fill in when nobody is there */
  let members = v.members.filter((m) => !m.deletedAt && m.active);
  const newMembers: Member[] = [];
  if (!members.length) {
    const mk = (name: string, role: Member["role"], title: string, cost: number, rate: number, color: string): Member => ({ id: ids.member(), name, email: "", role, title, hourlyCostCents: cost, hourlyRateCents: rate, weeklyHours: 38.5, color, active: true, phone: "", notes: "", createdAt: now, updatedAt: now });
    newMembers.push(mk("Max Muster", "owner", "Inhaber & Projektleitung", 4500, 9500, "#0a5fe0"), mk("Lena Huber", "member", "Grafikdesign", 3800, 8500, "#af52de"), mk("Tobias Gruber", "member", "Webentwicklung", 4000, 9000, "#ff9500"));
    members = newMembers;
  }
  const person = (first: string, i: number): Member | undefined => members.find((m) => m.name.toLowerCase().startsWith(first.toLowerCase())) ?? members[i % members.length];
  const team: Record<string, Member | undefined> = { Max: person("Max", 0), Lena: person("Lena", 1), Tobias: person("Tobias", 2) };

  /* customers from the demo contacts */
  const customers = v.contacts.filter((c) => !c.deletedAt && c.profileId === profileId && (c.kind === "customer" || c.kind === "both"));
  const newContacts: Contact[] = [];
  const customer = (pattern: RegExp, fallbackName: string, i: number): Contact => {
    const found = customers.find((c) => pattern.test(c.name)) ?? customers[i];
    if (found) return found;
    const c: Contact = { id: ids.contact(), profileId, name: fallbackName, kind: "customer", uid: "", email: "", phone: "", street: "", zip: "", city: "Wien", country: "AT", iban: "", notes: "", aliases: [], createdAt: now, updatedAt: now };
    newContacts.push(c);
    customers.push(c);
    return c;
  };
  const hotel = customer(/alpenblick/i, "Alpenblick Hotel GmbH", 0);
  const stadtwerke = customer(/stadtwerke/i, "Stadtwerke Linz GmbH", 1);
  const cafe = customer(/morgenrot/i, "Café Morgenrot", 2);

  const specs: ProjectSpec[] = [
    {
      key: "web",
      name: "Website-Relaunch Hotel Alpenblick",
      customer: hotel,
      status: "active",
      start: mondayOfIso(shiftIsoDate(today, -35)),
      hoursPerDay: 5,
      budgetCents: 1_480_000,
      budgetHours: 150,
      billing: "fixed",
      rateCents: 9500,
      manager: "Max",
      description: "Neue Website mit Online-Buchung, zweisprachig (DE/EN). Pauschal vereinbart laut Angebot, 30 % Anzahlung bei Auftrag.",
      tasks: [
        { title: "Konzept & Planung", children: [
          { title: "Kick-off-Workshop im Hotel", est: 4, who: ["Max", "Lena"] },
          { title: "Sitemap & Inhaltsstruktur", est: 8, who: ["Max"] },
          { title: "Moodboard & Stilrichtung", est: 6, who: ["Lena"] },
        ] },
        { title: "Design", children: [
          { title: "Startseite gestalten", est: 16, who: ["Lena"] },
          { title: "Zimmer- und Angebotsseiten", est: 14, who: ["Lena"] },
          { title: "Mobile Ansichten", est: 8, who: ["Lena"] },
          { title: "Feedbackrunde mit dem Hotel", est: 3, who: ["Max"] },
        ] },
        { title: "Umsetzung", children: [
          { title: "CMS einrichten", est: 10, who: ["Tobias"] },
          { title: "Templates programmieren", est: 28, who: ["Tobias"], prio: "high" },
          { title: "Buchungs-Widget einbinden", est: 8, who: ["Tobias"], prio: "high", desc: "Schnittstelle zum Buchungssystem des Hotels, Zugangsdaten kommen von der Rezeption." },
          { title: "Mehrsprachigkeit DE/EN", est: 6, who: ["Tobias"] },
        ] },
        { title: "Inhalte & Launch", children: [
          { title: "Texte und Fotos einpflegen", est: 12, who: ["Lena"] },
          { title: "Testen & Korrekturen", est: 6, who: ["Tobias", "Max"] },
          { title: "Go-Live & Einschulung", est: 4, who: ["Max"], prio: "urgent" },
        ] },
      ],
      milestones: [
        { title: "Design freigegeben", links: ["Design"], desc: "Freigabe durch die Geschäftsführung des Hotels." },
        { title: "Go-Live", links: ["Inhalte & Launch"], invoiceCents: 1_036_000 },
      ],
      statusOverride: { "Templates programmieren": "in_progress" },
      effort: { "Templates programmieren": 1.15, "Startseite gestalten": 1.1, "Sitemap & Inhaltsstruktur": 0.85 },
    },
    {
      key: "cd",
      name: "Corporate Design Café Morgenrot",
      customer: cafe,
      status: "completed",
      start: mondayOfIso(shiftIsoDate(today, -42)),
      hoursPerDay: 3,
      budgetCents: 420_000,
      budgetHours: 48,
      billing: "fixed",
      rateCents: 8500,
      manager: "Lena",
      description: "Neues Logo, Geschäftsausstattung und Speisekarten-Vorlage für die Neueröffnung.",
      tasks: [
        { title: "Analyse & Briefing", children: [
          { title: "Erstgespräch & Briefing", est: 2, who: ["Max"] },
          { title: "Markt- und Mitbewerberanalyse", est: 4, who: ["Lena"] },
        ] },
        { title: "Logo", children: [
          { title: "Drei Logo-Entwürfe", est: 12, who: ["Lena"] },
          { title: "Überarbeitung nach Feedback", est: 5, who: ["Lena"] },
          { title: "Reinzeichnung & Dateien", est: 3, who: ["Lena"] },
        ] },
        { title: "Geschäftsausstattung", children: [
          { title: "Visitenkarten & Briefpapier", est: 6, who: ["Lena"] },
          { title: "Speisekarten-Vorlage", est: 8, who: ["Lena", "Max"] },
          { title: "Designmanual", est: 6, who: ["Max"] },
        ] },
      ],
      milestones: [
        { title: "Logo freigegeben", links: ["Logo"] },
        { title: "Übergabe Designmanual", links: ["Designmanual"] },
      ],
      effort: { "Drei Logo-Entwürfe": 1.25, "Speisekarten-Vorlage": 0.9 },
    },
    {
      key: "messe",
      name: "Messestand Stadtwerke Linz – Energiemesse",
      customer: stadtwerke,
      status: "planning",
      start: addWorkdaysIso(today, -2),
      hoursPerDay: 4,
      budgetCents: 1_080_000,
      budgetHours: 120,
      billing: "hourly",
      rateCents: 9000,
      manager: "Max",
      description: "Gestaltung des Messestands (36 m²) inkl. Grafiken, Banner und Give-aways. Abrechnung nach Aufwand, Angebot liegt beim Kunden.",
      tasks: [
        { title: "Konzept", children: [
          { title: "Briefing-Termin vor Ort", est: 3, who: ["Max"] },
          { title: "Grobkonzept & Moodboard", est: 10, who: ["Lena", "Max"] },
          { title: "Konzept präsentieren", est: 4, who: ["Max"] },
        ] },
        { title: "Gestaltung", children: [
          { title: "Standdesign mit 3D-Visualisierung", est: 24, who: ["Lena"], prio: "high" },
          { title: "Grafiken & Banner", est: 16, who: ["Lena"] },
          { title: "Give-aways auswählen", est: 6, who: ["Max"], prio: "low" },
        ] },
        { title: "Produktion & Aufbau", children: [
          { title: "Druckdaten erstellen", est: 8, who: ["Lena"] },
          { title: "Abstimmung mit dem Messebauer", est: 6, who: ["Max"] },
          { title: "Aufbau begleiten", est: 10, who: ["Max", "Tobias"] },
        ] },
      ],
      milestones: [
        { title: "Konzept freigegeben", links: ["Konzept"] },
        { title: "Druckdaten an den Messebauer", links: ["Druckdaten erstellen"] },
      ],
    },
  ];

  const projects: Project[] = [];
  const tasks: Task[] = [];
  const milestones: Milestone[] = [];
  const entries: TimeEntry[] = [];
  const settings = v.settings.projects;
  let counter = settings.nextProjectNumber;
  const windowStart = shiftIsoDate(today, -42);

  for (const spec of specs) {
    const pid = ids.project();
    const pTasks: Task[] = [];
    const add = (s: Spec, parentId: string | undefined, order: number) => {
      const t: Task = {
        id: ids.task(),
        profileId,
        projectId: pid,
        parentId,
        order,
        title: s.title,
        description: s.desc ?? "",
        status: "todo",
        priority: s.prio ?? "medium",
        estimateHours: s.est ?? 0,
        assigneeIds: (s.who ?? []).map((w) => team[w]?.id).filter((x): x is string => !!x),
        createdAt: now,
        updatedAt: now,
      };
      pTasks.push(t);
      s.children?.forEach((c, i) => add(c, t.id, i));
    };
    spec.tasks.forEach((s, i) => add(s, undefined, i));

    const project: Project = {
      id: pid,
      profileId,
      number: formatNumber(settings.projectNumberPattern, counter++, spec.start),
      name: spec.name,
      customerId: spec.customer?.id,
      description: spec.description,
      status: spec.status,
      startDate: spec.start,
      budgetCents: spec.budgetCents,
      budgetHours: spec.budgetHours,
      billing: spec.billing,
      hourlyRateCents: spec.rateCents,
      managerId: spec.manager ? team[spec.manager]?.id : undefined,
      memberIds: [...new Set(pTasks.flatMap((t) => t.assigneeIds))],
      hoursPerDay: spec.hoursPerDay,
      color: "#0a5fe0",
      tags: [],
      notes: "",
      createdAt: now,
      updatedAt: now,
    };

    // milestones before scheduling so undated ones get their date from the tasks
    const pMilestones: Milestone[] = spec.milestones.map((m) => {
      const linked = pTasks.filter((t) => m.links.includes(t.title));
      return { id: ids.milestone(), profileId, projectId: pid, title: m.title, description: m.desc ?? "", status: "open", taskIds: linked.map((t) => t.id), invoiceAmountCents: m.invoiceCents, createdAt: now, updatedAt: now };
    });
    for (const m of pMilestones) for (const t of pTasks) if (m.taskIds.includes(t.id)) t.milestoneId = m.id;

    const plan = autoSchedule(project, pTasks, pMilestones, { startDate: spec.start, today });
    const isParent = new Set(pTasks.map((t) => t.parentId).filter(Boolean));
    for (const t of pTasks) {
      const r = plan.tasks.get(t.id);
      if (r) {
        t.startDate = r.startDate;
        t.dueDate = r.dueDate;
      }
      if (isParent.has(t.id)) continue;
      let status: TaskStatus = spec.status === "completed" ? "done" : !t.startDate || t.startDate > today ? "todo" : t.dueDate! < today ? "done" : "in_progress";
      status = spec.statusOverride?.[t.title] ?? status;
      if (status === "in_progress" && t.dueDate === today && random() < 0.4) status = "review";
      t.status = status;
      if (status === "done") t.completedAt = `${t.dueDate}T15:30:00.000Z`;
    }
    // work packages: done when all children are
    for (const t of pTasks) {
      if (!isParent.has(t.id)) continue;
      const kids = pTasks.filter((c) => c.parentId === t.id);
      t.status = kids.every((k) => k.status === "done") ? "done" : kids.some((k) => k.status !== "todo") ? "in_progress" : "todo";
      if (t.status === "done") t.completedAt = kids.map((k) => k.completedAt ?? "").sort().at(-1);
    }
    for (const m of pMilestones) {
      m.dueDate = plan.milestoneDates.get(m.id) ?? m.dueDate;
      if (m.dueDate && spec.status === "active") m.dueDate = addWorkdaysIso(m.dueDate, 2);
      const linked = pTasks.filter((t) => m.taskIds.includes(t.id));
      if (linked.length && linked.every((t) => t.status === "done")) {
        m.status = "done";
        m.completedAt = `${m.dueDate ?? today}T16:00:00.000Z`;
      }
    }
    project.endDate = spec.status === "completed" ? plan.endDate : plan.endDate ? addWorkdaysIso(plan.endDate, 5) : undefined;
    if (spec.status === "completed") project.completedAt = `${shiftIsoDate(plan.endDate ?? today, 3)}T10:00:00.000Z`;

    // time entries on the planned days (only the past, at most six weeks back)
    for (const t of pTasks) {
      if (isParent.has(t.id) || t.status === "todo" || !t.startDate || !t.dueDate) continue;
      const done = t.status === "done";
      const factor = done ? spec.effort?.[t.title] ?? 0.85 + random() * 0.3 : 0.3 + random() * 0.3;
      let total = Math.round((t.estimateHours * 60 * factor) / 15) * 15;
      if (total <= 0) continue;
      const last = done ? t.dueDate : today < t.dueDate ? today : t.dueDate;
      const days: string[] = [];
      for (let d = t.startDate; d <= last; d = shiftIsoDate(d, 1)) if (!isWeekendIso(d) && d >= windowStart && d <= today) days.push(d);
      if (!days.length) days.push(last >= windowStart ? last : windowStart);
      const people = t.assigneeIds.length ? t.assigneeIds : [undefined];
      days.forEach((day, i) => {
        const remaining = days.length - i;
        let minutes = i === days.length - 1 ? total : Math.max(30, Math.round(total / remaining / 15) * 15 + (random() < 0.5 ? -15 : 15));
        minutes = Math.min(minutes, total);
        if (minutes <= 0) return;
        total -= minutes;
        const memberId = people[i % people.length];
        const member = members.find((m) => m.id === memberId);
        const hour = 8 + Math.floor(random() * 5);
        entries.push({
          id: ids.timeEntry(),
          profileId,
          projectId: pid,
          taskId: t.id,
          memberId,
          date: day,
          minutes,
          description: i === 0 ? "" : NOTES.default![Math.floor(random() * NOTES.default!.length)]!,
          billable: spec.billing !== "internal",
          ...timeEntryRates(project, member),
          createdAt: `${day}T${String(hour).padStart(2, "0")}:15:00.000Z`,
          updatedAt: `${day}T${String(hour).padStart(2, "0")}:15:00.000Z`,
        });
      });
    }
    // weekly project meeting without a task (not billed) on the running website project
    if (spec.key === "web") {
      const max = team.Max;
      for (let w = 4; w >= 1; w--) {
        const day = shiftIsoDate(mondayOfIso(shiftIsoDate(today, -7 * w)), 1);
        entries.push({ id: ids.timeEntry(), profileId, projectId: pid, memberId: max?.id, date: day, minutes: 45, description: "Wöchentliche Abstimmung mit dem Team", billable: false, ...timeEntryRates(project, max), createdAt: `${day}T09:00:00.000Z`, updatedAt: `${day}T09:00:00.000Z` });
      }
    }

    projects.push(project);
    tasks.push(...pTasks);
    milestones.push(...pMilestones);
  }

  store.mutate(
    (vault) => {
      if (newMembers.length) vault.members = [...vault.members, ...newMembers];
      if (newContacts.length) vault.contacts = [...vault.contacts, ...newContacts];
      vault.projects = [...vault.projects, ...projects];
      vault.tasks = [...vault.tasks, ...tasks];
      vault.milestones = [...vault.milestones, ...milestones];
      vault.timeEntries = [...vault.timeEntries, ...entries];
      // the Ordo demo has an invoice for the website concept and one for the café's menus – they belong to these projects
      const web = projects[0]!;
      const cd = projects[1]!;
      vault.invoices = vault.invoices.map((inv) => {
        if (inv.deletedAt || inv.profileId !== profileId || inv.projectId) return inv;
        if (inv.customerId === web.customerId && inv.lines.some((l) => /website/i.test(l.description))) return { ...inv, projectId: web.id };
        if (inv.customerId === cd.customerId && inv.lines.some((l) => /speisekarte/i.test(l.description))) return { ...inv, projectId: cd.id };
        return inv;
      });
      vault.settings = { ...vault.settings, projects: { ...vault.settings.projects, nextProjectNumber: counter } };
    },
    { audit: { action: "demo.seed", entity: "projects", details: `${projects.length}` } },
  );
}
