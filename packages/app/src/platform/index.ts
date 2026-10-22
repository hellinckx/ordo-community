import type { Platform } from "./types";

export * from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let platformPromise: Promise<Platform> | null = null;

export function getPlatform(): Promise<Platform> {
  if (!platformPromise) {
    platformPromise = isTauri ? import("./tauri").then((m) => m.createTauriPlatform()) : import("./web").then((m) => m.createWebPlatform());
  }
  return platformPromise;
}

export const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isStandalonePwa = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
