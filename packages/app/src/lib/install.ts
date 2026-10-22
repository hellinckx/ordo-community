/**
 * Ordo as an app on the phone (PWA). Android Chrome offers a real install prompt (beforeinstallprompt) – caught
 * here as early as possible, it fires before React is up. iPhone has none: there it goes over Teilen →
 * "Zum Home-Bildschirm". The early redirect in index.html sends a phone that opens /app/ to the download page first;
 * "?installieren" from there opens the install dialog, "?browser" keeps the browser version without asking again.
 */
import { create } from "zustand";
import { isTauri } from "@/platform";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const BROWSER_KEY = "ordo.mobile.browser";
const INSTALL_KEY = "ordo.install";

export const isStandalone = (): boolean => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
export const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isPhone = (): boolean => isIos() || /Android/i.test(navigator.userAgent);

interface InstallState {
  prompt: InstallPrompt | null;
  /** The dialog is asked for ("?installieren" from the download page). */
  open: boolean;
  installed: boolean;
  setOpen(open: boolean): void;
  install(): Promise<boolean>;
}

export const useInstall = create<InstallState>((set, get) => ({
  prompt: null,
  open: false,
  installed: false,
  setOpen(open) {
    set({ open });
    if (!open) {
      try {
        sessionStorage.removeItem(INSTALL_KEY);
        // whoever closes the dialog stays in the browser from now on
        localStorage.setItem(BROWSER_KEY, "1");
      } catch {
        /* private mode */
      }
    }
  },
  async install() {
    const p = get().prompt;
    if (!p) return false;
    await p.prompt();
    const { outcome } = await p.userChoice;
    set({ prompt: null });
    if (outcome === "accepted") set({ installed: true, open: false });
    return outcome === "accepted";
  },
}));

/** Called once from main.tsx. */
export function setupInstall(): void {
  if (isTauri) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    useInstall.setState({ prompt: e as InstallPrompt });
  });
  window.addEventListener("appinstalled", () => useInstall.setState({ installed: true, prompt: null, open: false }));
  try {
    if (sessionStorage.getItem(INSTALL_KEY) && isPhone() && !isStandalone()) useInstall.setState({ open: true });
  } catch {
    /* private mode */
  }
}
