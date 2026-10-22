/**
 * Copies the OCR runtime (tesseract.js worker + wasm cores) into public/ and downloads the
 * German/English traineddata so the app works fully offline (desktop) and caches them in the PWA.
 */
import { createRequire } from "node:module";
import { mkdirSync, copyFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(resolve(root, "../core/package.json"));

const pub = join(root, "public");
const tess = join(pub, "tesseract");
const tessdata = join(pub, "tessdata");
mkdirSync(tess, { recursive: true });
mkdirSync(tessdata, { recursive: true });

// worker
const workerSrc = require.resolve("tesseract.js/dist/worker.min.js");
copyFileSync(workerSrc, join(tess, "worker.min.js"));

// cores
const requireFromTess = createRequire(require.resolve("tesseract.js/package.json"));
const corePkg = dirname(requireFromTess.resolve("tesseract.js-core/package.json"));
for (const f of readdirSync(corePkg)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copyFileSync(join(corePkg, f), join(tess, f));
}
console.log("tesseract runtime copied to public/tesseract");

// traineddata (tessdata_fast, gzipped) – skipped when present
const langs = ["deu", "eng"];
for (const lang of langs) {
  const target = join(tessdata, `${lang}.traineddata.gz`);
  if (existsSync(target) && statSync(target).size > 100_000) {
    console.log(`${lang}.traineddata.gz present`);
    continue;
  }
  const urls = [
    `https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_best_int/${lang}.traineddata.gz`,
    `https://tessdata.projectnaptha.com/4.0.0_best_int/${lang}.traineddata.gz`,
    `https://tessdata.projectnaptha.com/4.0.0/${lang}.traineddata.gz`,
  ];
  let ok = false;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(target, buf);
      console.log(`downloaded ${lang} (${(buf.length / 1e6).toFixed(1)} MB) from ${url}`);
      ok = true;
      break;
    } catch (e) {
      console.warn(`failed ${url}: ${e.message}`);
    }
  }
  if (!ok) console.warn(`WARNING: could not download ${lang}.traineddata.gz – OCR will fetch it online at runtime.`);
}
