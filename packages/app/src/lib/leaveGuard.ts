/**
 * While invoices are being read, a reload or closing the window would cut that off – what was read and what the
 * AI provider already charged for would be lost. (Atlas is not in here: its runs continue on their own after a
 * reload – see resumeInterrupted in atlas/engine.ts.) Then:
 * - the browser asks before reloading or closing the tab (its own dialog, the text is the browser's),
 * - the desktop app asks before closing the window,
 * - Ordo's own reloads (update, restart) ask first.
 */
import { create } from "zustand";
import { isTauri } from "@/platform";
import { useImporter } from "@/services/importer";

/** What is still running and would be lost – one line each, empty when nothing runs. */
export function runningWork(): string[] {
  const out: string[] = [];
  const reading = useImporter.getState().jobs.filter((j) => j.status !== "done" && j.status !== "duplicate" && j.status !== "error").length;
  if (reading) out.push(reading === 1 ? "Eine Rechnung wird noch gelesen." : `${reading} Rechnungen werden noch gelesen.`);
  return out;
}

interface LeaveGuard {
  pending: { what: string[]; go: () => void } | null;
  cancel(): void;
  confirm(): void;
}

export const useLeaveGuard = create<LeaveGuard>((set, get) => ({
  pending: null,
  cancel: () => set({ pending: null }),
  confirm: () => {
    const p = get().pending;
    set({ pending: null });
    p?.go();
  },
}));

/** Does `go` right away – or, while something runs, only after the person confirms. */
export function guardLeave(go: () => void): void {
  const what = runningWork();
  if (!what.length) go();
  else useLeaveGuard.setState({ pending: { what, go } });
}

/** Called once on start. */
export function setupLeaveGuard(): void {
  window.addEventListener("beforeunload", (e) => {
    if (!runningWork().length) return;
    e.preventDefault();
    // older browsers need a return value to show their dialog
    e.returnValue = "";
  });
  if (!isTauri) return;
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      return win.onCloseRequested((e) => {
        if (!runningWork().length) return;
        e.preventDefault();
        guardLeave(() => void win.destroy());
      });
    })
    .catch(() => {
      /* no window API (tests, older shell) – the browser dialog still covers reloads */
    });
}
