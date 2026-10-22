// Stand-in for "virtual:pwa-register" in builds without the PWA plugin (desktop / single file).
export function registerSW(_opts?: unknown): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
