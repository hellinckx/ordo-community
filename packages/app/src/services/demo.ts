import { VaultStore, seedDemoVault, parseReceiptText, nowIso, ids, type SummaDocument, type Extraction } from "@ordo/core";
import { getPlatform } from "@/platform";
import { useSession } from "@/state/session";
import { getTextExtractor } from "./extraction";

export const DEMO_PASSWORD = "demo";
export const DEMO_HINT = "Demo-Tresor – Passwort: demo";

/**
 * Guest mode: creates a vault protected with the well-known password "demo", fills it with the
 * generated sample data and attaches the sample receipt image / invoice PDF so every screen has content.
 */
export async function startDemo(onStatus?: (s: string) => void): Promise<void> {
  const platform = useSession.getState().platform ?? (await getPlatform());
  onStatus?.("Demo-Tresor wird erstellt …");
  if (await VaultStore.exists(platform.storage)) await platform.wipe();
  const { store } = await VaultStore.create(platform.storage, { password: DEMO_PASSWORD, hint: DEMO_HINT, profileName: "Demo", mode: "business", withRecoveryKey: false });
  onStatus?.("Beispieldaten werden erzeugt …");
  let seed: ReturnType<typeof seedDemoVault> | null = null;
  store.mutate((v) => {
    v.profiles = [];
    seed = seedDemoVault(v);
  }, { audit: { action: "demo.seed", entity: "vault" } });
  if (!seed) throw new Error("Demo-Daten konnten nicht erzeugt werden.");
  const s = seed as ReturnType<typeof seedDemoVault>;
  // the demo shows everything Ordo can do: all modules installed, each adds its sample data to the business profile
  const { ALL_MODULES } = await import("@/modules/registry");
  const business = store.vault.profiles.find((p) => p.mode === "business");
  store.mutate((v) => {
    v.settings = { ...v.settings, modules: Object.fromEntries(ALL_MODULES.map((m) => [m.id, { installed: true, installedAt: nowIso() }])) };
  });
  if (business) {
    for (const m of ALL_MODULES) {
      try {
        m.seedDemo?.(store, business.id);
      } catch (e) {
        console.warn(`Demo-Daten für ${m.name} fehlgeschlagen`, e);
      }
    }
  }
  onStatus?.("Beispielbelege werden angehängt …");
  try {
    await attachDemoDocuments(store, s);
  } catch (e) {
    console.warn("Demo-Belege konnten nicht angehängt werden", e);
  }
  await store.saveNow();
  useSession.getState().adopt(store);
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function attachDemoDocuments(store: VaultStore, seed: ReturnType<typeof seedDemoVault>) {
  const now = nowIso();
  const png = await fetchBytes("demo/kassenbon_billa.png");
  const pdf = await fetchBytes("demo/rechnung_mustermann.pdf");
  const settings = store.vault.settings;
  const extractor = getTextExtractor(settings);

  // Invoice PDF: text layer only (fast), rendered preview for the review screen
  const pdfLocal = await extractor.extractPdf(pdf);
  const pdfRules = parseReceiptText(pdfLocal.text, { ownNames: ["Muster Design"] });
  const pdfExtraction: Extraction = { provider: "rules", extractedAt: now, text: pdfLocal.text, fields: pdfRules.fields, confidence: pdfRules.confidence, overall: pdfRules.overall, warnings: pdfRules.warnings };

  const receiptText = [
    "BILLA AG", "Filiale 4711 - 1070 Wien", "Mariahilfer Strasse 10", "UID: ATU 12345678", "", "Kassenbon Nr. 4711/2026", "Datum: 12.03.2026 17:42", "",
    "Bio Milch 1L            1,29 A", "Vollkornbrot            3,49 A", "Kaffee Bohnen 500g      7,99 B", "Mineralwasser 6x1,5L    4,74 A", "",
    "SUMME EUR              17,51", "Bankomat               17,51", "", "MwSt   Netto   Steuer  Brutto", "A 10%   8,65    0,87    9,52", "B 20%   6,66    1,33    7,99",
  ].join("\n");
  const receiptRules = parseReceiptText(receiptText);
  const receiptExtraction: Extraction = { provider: "rules", extractedAt: now, text: receiptText, fields: receiptRules.fields, confidence: receiptRules.confidence, overall: receiptRules.overall, warnings: [] };

  const business = seed.ids.business;
  const employee = seed.ids.employee;

  // business: approved receipt + invoice waiting for review
  const attReceipt = await store.putAttachment(business, png, { name: "kassenbon_billa.png", mime: "image/png" });
  const attPdf = await store.putAttachment(business, pdf, { name: "rechnung_mustermann.pdf", mime: "application/pdf", pages: pdfLocal.pages });
  const attPdfPreview = pdfLocal.previewPng ? await store.putAttachment(business, pdfLocal.previewPng, { name: "rechnung_mustermann.preview.png", mime: "image/png" }) : undefined;
  const docReceipt: SummaDocument = { id: ids.document(), profileId: business, attachmentId: attReceipt.id, originalName: "kassenbon_billa.png", mime: "image/png", sha256: attReceipt.sha256, source: "camera", importedAt: now, status: "approved", extraction: receiptExtraction, transactionId: seed.receiptTxId, reviewedAt: now, createdAt: now, updatedAt: now };
  const docInvoice: SummaDocument = { id: ids.document(), profileId: business, attachmentId: attPdf.id, previewAttachmentId: attPdfPreview?.id, originalName: "rechnung_mustermann.pdf", mime: "application/pdf", sha256: attPdf.sha256, source: "folder", originalPath: "C:\\Belege\\rechnung_mustermann.pdf", importedAt: now, status: "review", extraction: pdfExtraction, transactionId: seed.invoiceTxId, createdAt: now, updatedAt: now };

  // employee: the same receipt as an unreviewed draft
  const attReceipt2 = await store.putAttachment(employee, png, { name: "kassenbon_billa.png", mime: "image/png" });
  const draft = store.vault.transactions.find((t) => t.profileId === employee && !t.reviewed);
  const docReceipt2: SummaDocument = { id: ids.document(), profileId: employee, attachmentId: attReceipt2.id, originalName: "kassenbon_billa.png", mime: "image/png", sha256: attReceipt2.sha256, source: "camera", importedAt: now, status: "review", extraction: receiptExtraction, transactionId: draft?.id, createdAt: now, updatedAt: now };

  store.mutate((v) => {
    v.documents = [...v.documents, docReceipt, docInvoice, docReceipt2];
    v.transactions = v.transactions.map((t) => {
      if (t.id === seed.receiptTxId) return { ...t, documentIds: [docReceipt.id] };
      if (t.id === seed.invoiceTxId) return { ...t, documentIds: [docInvoice.id], reviewed: false };
      if (draft && t.id === draft.id) return { ...t, documentIds: [docReceipt2.id] };
      return t;
    });
  });
}

/** Leaves the demo: locks, wipes the demo vault and restarts the onboarding. */
export async function exitDemo(): Promise<void> {
  const { platform, lock } = useSession.getState();
  await lock();
  await platform!.wipe();
  location.reload();
}
