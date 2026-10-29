/** Release gate: public installers must work locally without a configured database or private update service. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fail = (message) => { throw new Error(`Community-Ausgabe: ${message}`); };
const config = readFileSync(join(root, "packages/app/src/operator/config.ts"), "utf8");
for (const [name, value] of Object.entries({ edition: '"community"', server: "null", updates: "false", fetchAnnouncements: "null" })) {
  if (!new RegExp(`\\b${name}:\\s*${value}\\s*[,}]`).test(config)) fail(`${name} ist nicht unabhängig konfiguriert.`);
}
if (!/\bwebUrl:\s*""/.test(config) || !/\bprovider:\s*null/.test(config)) fail("Betreiberadresse gefunden.");
for (const key of ["VITE_ORDO_SYNC_URL", "VITE_ORDO_SYNC_ANON_KEY", "VITE_ORDO_WEB_URL", "VITE_SUMMA_SYNC_URL", "VITE_SUMMA_SYNC_ANON_KEY", "VITE_SUMMA_WEB_URL"]) {
  if (process.env[key]) fail(`${key} darf beim öffentlichen Download nicht gesetzt sein.`);
}
for (const dir of [root, join(root, "packages/app")]) {
  if (readdirSync(dir).some((name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example")) fail("Lokale Build-Konfiguration gefunden.");
}
const desktop = JSON.parse(readFileSync(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
if (desktop.identifier !== "at.ordo.community" || desktop.plugins.updater.endpoints.length || desktop.plugins.updater.pubkey || desktop.bundle.createUpdaterArtifacts) fail("Privater Updatekanal oder falsche App-Kennung.");

if (process.argv.includes("--built")) {
  const dist = join(root, "packages/app/dist");
  if (!existsSync(dist)) fail("Frontend-Build fehlt.");
  const inspect = (dir) => {
    for (const entry of readdirSync(dir, {withFileTypes:true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(js|html|json)$/.test(entry.name)) {
        const body = readFileSync(path, "utf8");
        // The setup form includes a fictional example; any other baked-in database is a release failure.
        const hosts = body.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/gi) ?? [];
        if (hosts.some((host) => host !== "https://abcdefghijklmnopqrst.supabase.co")) fail(`Datenbank-Adresse im Build: ${entry.name}`);
        if (/(?:ordo|summa)-(?:download|admin)|summa_(?:feedback|poll|announcements)/i.test(body)) fail(`Betreiberdienst im Build: ${entry.name}`);
      }
    }
  };
  inspect(dist);
}
console.log("Community-Ausgabe geprüft: kein vorkonfigurierter Server, kein privater Login oder Updatekanal.");
