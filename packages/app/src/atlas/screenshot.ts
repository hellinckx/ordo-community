/**
 * A picture of what Ordo shows right now, for Atlas. It is drawn from the app's own page (not the screen): other
 * windows, the desktop and the browser around Ordo are never in it, and neither is the Atlas window itself. Nothing is
 * sent here – the picture is only attached to the message the person is writing.
 */
import type { PickedFile } from "@/platform/types";

/** Marks the parts that stay out of the picture (the Atlas window and its button). */
export const NOT_IN_SCREENSHOT = "data-atlas-widget";

export interface Screenshot {
  file: PickedFile;
  width: number;
  height: number;
}

export async function captureApp(): Promise<Screenshot> {
  const { domToCanvas } = await import("modern-screenshot");
  const width = window.innerWidth;
  const height = window.innerHeight;
  // sharp enough to read, never larger than what the models look at
  const scale = Math.min(window.devicePixelRatio || 1, 1600 / Math.max(width, height));
  const canvas = await domToCanvas(document.body, {
    width,
    height,
    scale,
    backgroundColor: getComputedStyle(document.body).backgroundColor || null,
    filter: (n) => !(n instanceof Element && n.hasAttribute(NOT_IN_SCREENSHOT)),
    features: { restoreScrollPosition: true },
    timeout: 8000,
  });
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Bild konnte nicht erstellt werden"))), "image/png"));
  const at = new Date();
  const time = `${String(at.getHours()).padStart(2, "0")}-${String(at.getMinutes()).padStart(2, "0")}-${String(at.getSeconds()).padStart(2, "0")}`;
  return { file: { name: `Bildschirmfoto ${time}.png`, mime: "image/png", bytes: new Uint8Array(await blob.arrayBuffer()) }, width: canvas.width, height: canvas.height };
}

/** The page title as people read it ("Projekte", "Eingehende Rechnungen" …), for the line in the message. */
export function pageName(): string {
  const h = document.querySelector("main h1")?.textContent?.trim();
  return (h || document.title.replace(/\s*[–|-]\s*Ordo.*$/, "").trim() || location.pathname).slice(0, 60);
}
