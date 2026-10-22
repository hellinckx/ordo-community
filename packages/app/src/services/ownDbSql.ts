/**
 * What a person copies into their own Supabase project. Loaded only when the setup opens (dynamic import), so the
 * app bundle stays small. The SQL is the same schema the Ordo server runs, plus the own-project defaults.
 */
import schemaSql from "../../../../supabase/schema.sql?raw";
import ownProjectSql from "../../../../supabase/own-project.sql?raw";

export const SETUP_SQL = `-- Ordo – Einrichtung für dein eigenes Supabase-Projekt. Einfach komplett einfügen und „Run“ drücken.\n-- Legt nur Ordo-Tabellen (summa_…) mit Zugriffsschutz an. Liest nichts aus und schickt nichts an Ordo.\n\n${schemaSql}\n\n${ownProjectSql}`;
