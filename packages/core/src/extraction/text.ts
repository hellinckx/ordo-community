/**
 * Local (offline) text extraction from receipts: PDF text layer, OCR for images/scanned PDFs,
 * spreadsheets and plain text. Browser-only parts are loaded lazily so the core stays importable in Node.
 */
import { isEInvoiceXml } from "./einvoice";

export type FileKind = "pdf" | "image" | "spreadsheet" | "csv" | "text" | "xml" | "unsupported";

export interface LocalTextResult {
  kind: FileKind;
  text: string;
  pages: number;
  /** PNG renderings of the first pages (PDF) or the image itself – fed to AI/OCR and used as preview. */
  images: Uint8Array[];
  previewPng?: Uint8Array;
  /** XML of an e-invoice (ZUGFeRD/Factur-X/UBL embedded in a PDF, or a standalone ebInterface/UBL/CII file). */
  einvoiceXml?: string;
  ocrConfidence?: number;
  width?: number;
  height?: number;
  warnings: string[];
}

export interface OcrEngine {
  recognize(png: Uint8Array): Promise<{ text: string; confidence: number }>;
}

export interface TextExtractorConfig {
  /** vite: import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url' */
  pdfWorkerSrc?: string;
  ocr?: OcrEngine;
  /** Max pages to render for PDFs (AI input / OCR). */
  maxPages?: number;
  renderScale?: number;
}

export function detectKind(name: string, mime: string, bytes?: Uint8Array): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (bytes && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "tif", "tiff", "avif"].includes(ext)) return "image";
  if (["xlsx", "xlsm", "xls"].includes(ext) || mime.includes("spreadsheet") || mime.includes("ms-excel")) return "spreadsheet";
  if (ext === "csv" || mime === "text/csv") return "csv";
  if (ext === "xml" || mime === "application/xml" || mime === "text/xml") return "xml";
  if (ext === "txt" || ext === "md" || ext === "eml" || mime.startsWith("text/")) return "text";
  return "unsupported";
}

export function mimeFor(name: string, fallback = "application/octet-stream"): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", heic: "image/heic", tif: "image/tiff", tiff: "image/tiff", avif: "image/avif",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv", txt: "text/plain", md: "text/markdown", eml: "message/rfc822", xml: "application/xml",
  };
  return map[ext] ?? fallback;
}

const td = new TextDecoder();

export class TextExtractor {
  constructor(private cfg: TextExtractorConfig = {}) {}

  configure(cfg: Partial<TextExtractorConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
  }

  /** `ocr: false` skips local OCR (the AI reads the image itself); the PDF text layer is still read. */
  async extract(bytes: Uint8Array, name: string, mime: string, opts: { ocr?: boolean } = {}): Promise<LocalTextResult> {
    const kind = detectKind(name, mime, bytes);
    switch (kind) {
      case "pdf":
        return this.extractPdf(bytes, opts);
      case "image":
        return this.extractImage(bytes, mime, opts);
      case "spreadsheet":
        return this.extractSpreadsheet(bytes);
      case "csv":
      case "text":
        return { kind, text: td.decode(bytes), pages: 1, images: [], warnings: [] };
      case "xml": {
        // standalone e-invoice (ebInterface, XRechnung/PEPPOL UBL, CII) – read like the XML inside a ZUGFeRD PDF
        const text = td.decode(bytes);
        const einvoice = isEInvoiceXml(text);
        return { kind, text: einvoice ? "" : text.slice(0, 20000), pages: 1, images: [], einvoiceXml: einvoice ? text : undefined, warnings: einvoice ? [] : ["Diese XML-Datei ist keine bekannte E-Rechnung (ebInterface, XRechnung/PEPPOL, ZUGFeRD)."] };
      }
      default:
        return { kind, text: "", pages: 0, images: [], warnings: [`Dateityp „${name.split(".").pop()}“ wird nicht unterstützt.`] };
    }
  }

  /* ---------------- PDF ---------------- */

  private async pdfjs() {
    const lib = await import("pdfjs-dist");
    if (this.cfg.pdfWorkerSrc && lib.GlobalWorkerOptions.workerSrc !== this.cfg.pdfWorkerSrc) lib.GlobalWorkerOptions.workerSrc = this.cfg.pdfWorkerSrc;
    return lib;
  }

  async extractPdf(bytes: Uint8Array, opts: { ocr?: boolean } = {}): Promise<LocalTextResult> {
    const warnings: string[] = [];
    const lib = await this.pdfjs();
    const doc = await lib.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
    const maxPages = this.cfg.maxPages ?? 3;
    let einvoiceXml: string | undefined;
    try {
      const atts = (await doc.getAttachments()) as Record<string, { filename: string; content: Uint8Array }> | null;
      const { findEInvoiceAttachment } = await import("./einvoice");
      einvoiceXml = findEInvoiceAttachment(atts) ?? undefined;
    } catch {
      /* no attachments */
    }
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += textContentToLines(content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) + "\n\n";
    }
    const images: Uint8Array[] = [];
    let width: number | undefined;
    let height: number | undefined;
    const canRender = typeof document !== "undefined" || typeof OffscreenCanvas !== "undefined";
    if (canRender) {
      for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
        try {
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale: this.cfg.renderScale ?? 1.6 });
          const { canvas, ctx } = makeCanvas(viewport.width, viewport.height);
          await page.render({ canvasContext: ctx as CanvasRenderingContext2D, viewport, canvas: canvas as HTMLCanvasElement }).promise;
          images.push(await canvasToPng(canvas));
          if (p === 1) {
            width = viewport.width;
            height = viewport.height;
          }
        } catch (e) {
          warnings.push(`Seite ${p} konnte nicht gerendert werden: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    let ocrConfidence: number | undefined;
    if (text.replace(/\s+/g, "").length < 40 && opts.ocr !== false) {
      if (this.cfg.ocr && images.length) {
        text = "";
        let confSum = 0;
        for (const img of images) {
          const r = await this.cfg.ocr.recognize(img);
          text += r.text + "\n\n";
          confSum += r.confidence;
        }
        ocrConfidence = confSum / images.length;
        warnings.push("PDF ohne Textebene – Text per OCR erkannt.");
      } else {
        warnings.push("PDF enthält keine Textebene (Scan). OCR nicht verfügbar.");
      }
    }
    await doc.destroy();
    return { kind: "pdf", text, pages: doc.numPages, images, previewPng: images[0], einvoiceXml, ocrConfidence, width, height, warnings };
  }

  /* ---------------- Images ---------------- */

  async extractImage(bytes: Uint8Array, mime: string, opts: { ocr?: boolean } = {}): Promise<LocalTextResult> {
    const warnings: string[] = [];
    let png = bytes;
    let width: number | undefined;
    let height: number | undefined;
    if (typeof createImageBitmap !== "undefined") {
      try {
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
        width = bmp.width;
        height = bmp.height;
        // Normalise to PNG and downscale very large photos (speeds up OCR and AI upload).
        const maxDim = 2200;
        const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
        if (scale < 1 || !mime.includes("png")) {
          const { canvas, ctx } = makeCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
          ctx.drawImage(bmp, 0, 0, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
          png = await canvasToPng(canvas);
        }
        bmp.close();
      } catch (e) {
        warnings.push(`Bild konnte nicht dekodiert werden (${mime}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    let text = "";
    let ocrConfidence: number | undefined;
    if (opts.ocr === false) {
      // read by the AI from the image – no local OCR
    } else if (this.cfg.ocr) {
      const r = await this.cfg.ocr.recognize(png);
      text = r.text;
      ocrConfidence = r.confidence;
    } else {
      warnings.push("OCR nicht konfiguriert – nur KI-Erkennung möglich.");
    }
    return { kind: "image", text, pages: 1, images: [png], previewPng: png, ocrConfidence, width, height, warnings };
  }

  /* ---------------- Spreadsheets ---------------- */

  async extractSpreadsheet(bytes: Uint8Array): Promise<LocalTextResult> {
    const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const lines: string[] = [];
    wb.eachSheet((sheet) => {
      lines.push(`# ${sheet.name}`);
      sheet.eachRow((row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value;
          if (v === null || v === undefined) return;
          if (typeof v === "object" && "result" in v) cells.push(String((v as { result: unknown }).result ?? ""));
          else if (typeof v === "object" && "richText" in v) cells.push((v as { richText: { text: string }[] }).richText.map((r) => r.text).join(""));
          else if (v instanceof Date) cells.push(`${pad(v.getDate())}.${pad(v.getMonth() + 1)}.${v.getFullYear()}`);
          else if (typeof v === "number") cells.push(v.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
          else cells.push(String(v));
        });
        if (cells.length) lines.push(cells.join(" | "));
      });
    });
    return { kind: "spreadsheet", text: lines.join("\n"), pages: wb.worksheets.length, images: [], warnings: [] };
  }
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Groups pdf.js text items into lines by their y-position so amounts stay next to their labels. */
export function textContentToLines(items: { str: string; transform: number[]; hasEOL?: boolean }[]): string {
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]! / 3) * 3;
    const x = it.transform[4]!;
    let row = rows.get(y);
    if (!row) {
      row = [];
      rows.set(y, row);
    }
    row.push({ x, str: it.str });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((r) => r.str).join(" ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return { canvas, ctx: canvas.getContext("2d")! };
  }
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  return { canvas, ctx: canvas.getContext("2d")! };
}

async function canvasToPng(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  let blob: Blob;
  if ("convertToBlob" in canvas) blob = await canvas.convertToBlob({ type: "image/png" });
  else blob = await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Lazy tesseract.js OCR engine (browser). Languages are loaded once; worker is reused. */
export function createTesseractOcr(opts: { languages?: string[]; workerPath?: string; corePath?: string; langPath?: string; logger?: (m: unknown) => void } = {}): OcrEngine & { terminate(): Promise<void> } {
  let workerPromise: Promise<import("tesseract.js").Worker> | null = null;
  const langs = opts.languages ?? ["deu", "eng"];
  const get = async () => {
    if (!workerPromise) {
      workerPromise = (async () => {
        const mod = (await import("tesseract.js")) as unknown as { createWorker?: typeof import("tesseract.js").createWorker; default?: { createWorker: typeof import("tesseract.js").createWorker } };
        const createWorker = mod.createWorker ?? mod.default?.createWorker;
        if (!createWorker) throw new Error("tesseract.js konnte nicht geladen werden.");
        const worker = await createWorker(langs, 1, {
          workerPath: opts.workerPath,
          corePath: opts.corePath,
          langPath: opts.langPath,
          logger: opts.logger ?? (() => {}),
          gzip: true,
        } as Parameters<typeof createWorker>[2]);
        await worker.setParameters({ preserve_interword_spaces: "1" });
        return worker;
      })();
    }
    return workerPromise;
  };
  return {
    async recognize(png) {
      const worker = await get();
      const res = await worker.recognize(new Blob([png as BlobPart], { type: "image/png" }) as unknown as Parameters<typeof worker.recognize>[0]);
      return { text: res.data.text ?? "", confidence: (res.data.confidence ?? 0) / 100 };
    },
    async terminate() {
      if (workerPromise) {
        const w = await workerPromise;
        await w.terminate();
        workerPromise = null;
      }
    },
  };
}
