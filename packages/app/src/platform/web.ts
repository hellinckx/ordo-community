import { IndexedDbStorage, mimeFor } from "@ordo/core";
import type { Platform, PickedFile } from "./types";

function pickViaInput(opts: { multiple?: boolean; accept?: string[]; capture?: boolean } = {}): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = opts.multiple ?? true;
    input.accept = (opts.accept ?? [".pdf", "image/*", ".xlsx", ".xls", ".csv", ".txt"]).join(",");
    if (opts.capture) input.setAttribute("capture", "environment");
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      const out: PickedFile[] = [];
      for (const f of files) out.push({ name: f.name, mime: f.type || mimeFor(f.name), bytes: new Uint8Array(await f.arrayBuffer()) });
      input.remove();
      resolve(out);
    };
    input.oncancel = () => {
      input.remove();
      resolve([]);
    };
    input.click();
  });
}

export function createWebPlatform(): Platform {
  const storage = new IndexedDbStorage("summa");
  return {
    kind: "web",
    storage,
    pickFiles: pickViaInput,
    async pickFolder() {
      return null;
    },
    async saveFile(name, bytes, mime) {
      const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }> };
      try {
        if (w.showSaveFilePicker) {
          const handle = await w.showSaveFilePicker({ suggestedName: name });
          const writable = await handle.createWritable();
          await writable.write(new Blob([bytes as BlobPart], { type: mime }));
          await writable.close();
          return true;
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return false;
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 2000);
      return true;
    },
    async notify(title, body) {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          const icon = `${import.meta.env.BASE_URL}icon-192.png`;
          if (reg) await reg.showNotification(title, { body, icon, badge: icon });
          else new Notification(title, { body, icon });
        } catch {
          /* ignore */
        }
      }
    },
    async requestNotificationPermission() {
      if (typeof Notification === "undefined") return false;
      if (Notification.permission === "granted") return true;
      const r = await Notification.requestPermission();
      return r === "granted";
    },
    async openUrl(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    async appInfo() {
      return { version: __APP_VERSION__ };
    },
    async wipe() {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("summa");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    },
  };
}
