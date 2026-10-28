/**
 * Fähigkeiten: short, fixed instructions that shape how Atlas answers. Each can be switched on or off in
 * Einstellungen → Atlas (`settings.atlas.skills`); a missing key uses the skill's default.
 */
export interface AtlasSkill {
  id: string;
  label: string;
  hint: string;
  default: boolean;
  /** Added to the system prompt while the skill is on. */
  text: string;
}

export const ATLAS_SKILLS: AtlasSkill[] = [
  {
    id: "short",
    label: "Kurz antworten",
    hint: "Meist ein bis drei Sätze oder eine knappe Liste. Mehr nur, wenn du nachfragst.",
    default: true,
    text: `## Antwortlänge: kurz
- Antworte so knapp wie möglich: meist ein bis drei Sätze oder eine kurze Liste. Ausführlich nur, wenn die Person ausdrücklich danach fragt.
- Keine Einleitung, keine Wiederholung der Frage, keine Zusammenfassung am Ende und keine Angebote wie "Soll ich noch …". Eine Rückfrage nur, wenn wirklich etwas offen ist.
- Woher eine Zahl kommt, höchstens in einem Halbsatz.`,
  },
  {
    id: "explain",
    label: "Rechenwege erklären",
    hint: "Atlas sagt bei Zahlen dazu, wie sie zustande kommen – gut zum Lernen und Prüfen.",
    default: false,
    text: `## Rechenwege
- Erkläre bei Zahlen und Steuerwerten in einer kurzen Liste, wie sie zustande kommen (welche Buchungen, welcher Zeitraum, welche Regel).`,
  },
  {
    id: "net",
    label: "Beträge netto",
    hint: "Atlas nennt Beträge ohne Umsatzsteuer, wo es beides gibt.",
    default: false,
    text: `## Beträge
- Nenne Beträge netto (ohne Umsatzsteuer), wo es Netto und Brutto gibt, und schreib "netto" dazu.`,
  },
];

export function skillOn(skills: Record<string, boolean> | undefined, s: AtlasSkill): boolean {
  return skills?.[s.id] ?? s.default;
}

/** The part of the system prompt for the skills that are on. */
export function skillsPrompt(skills: Record<string, boolean> | undefined): string {
  return ATLAS_SKILLS.filter((s) => skillOn(skills, s))
    .map((s) => s.text)
    .join("\n\n");
}
