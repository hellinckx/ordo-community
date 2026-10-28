import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  desktop: true, allowed: true, deferInstall: false, pendingGo: undefined as (() => void) | undefined,
  check: vi.fn(), version: vi.fn(), download: vi.fn(), install: vi.fn(), close: vi.fn(), relaunch: vi.fn(),
  flush: vi.fn(), openUrl: vi.fn(), registerSW: vi.fn(), refreshWeb: vi.fn(), swOptions: undefined as any,
  reload: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/platform", () => ({ get isTauri() { return m.desktop; } }));
vi.mock("@/operator/config", () => ({ OPERATOR: { get updates() { return m.allowed; }, website: "https://operator.example.test/", updateDownloadBase: "https://downloads.example.test/releases/" } }));
vi.mock("@/state/session", () => ({ useSession: { getState: () => ({ store: { flush: m.flush }, platform: { openUrl: m.openUrl } }) } }));
vi.mock("@/lib/leaveGuard", () => ({ guardLeave: (go: () => void) => { if (m.deferInstall) m.pendingGo = go; else go(); } }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: m.check }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: m.version }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: m.relaunch }));
vi.mock("virtual:pwa-register", () => ({ registerSW: m.registerSW }));

const update = (version = "0.4.3") => ({ currentVersion: "0.4.2", version, body: "Atlas und Updates", download: m.download, install: m.install, close: m.close });
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.stubEnv("DEV", false);
  m.desktop = true; m.allowed = true; m.deferInstall = false; m.pendingGo = undefined;
  m.version.mockResolvedValue("0.4.2"); m.flush.mockResolvedValue(undefined); m.install.mockResolvedValue(undefined); m.relaunch.mockResolvedValue(undefined); m.close.mockResolvedValue(undefined);
  m.check.mockResolvedValue(update());
  m.download.mockImplementation(async (onEvent) => {
    onEvent({ event: "Started", data: { contentLength: 100 } });
    onEvent({ event: "Progress", data: { chunkLength: 40 } });
    onEvent({ event: "Progress", data: { chunkLength: 60 } });
    onEvent({ event: "Finished" });
  });
  vi.stubGlobal("navigator", { userAgent: "Windows" });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { reload: m.reload } }));
  vi.stubGlobal("fetch", m.fetch);
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ version: "0.4.2" }) });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
});
afterEach(async () => { stop?.(); stop = undefined; await vi.dynamicImportSettled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("desktop updates", () => {
  it("offers the native installed version and retains the update across checks", async () => {
    const service = await import("./updates");
    await service.checkForUpdates();
    expect(service.useUpdates.getState()).toMatchObject({ currentVersion: "0.4.2", availableVersion: "0.4.3", phase: "available" });
    await service.checkForUpdates();
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(service.useUpdates.getState().phase).toBe("available");
  });
  it("coalesces concurrent checks and permits retry after a network error", async () => {
    const service = await import("./updates");
    m.check.mockRejectedValueOnce(new Error("offline"));
    await Promise.all([service.checkForUpdates(), service.checkForUpdates()]);
    expect(m.check).toHaveBeenCalledTimes(1);
    expect(service.useUpdates.getState().error).toBe("offline");
    await service.checkForUpdates();
    expect(service.useUpdates.getState().phase).toBe("available");
  });
  it("keeps an offered update visible if a later check fails", async () => {
    const service = await import("./updates");
    await service.checkForUpdates();
    m.check.mockRejectedValueOnce(new Error("offline"));
    await service.checkForUpdates();
    expect(service.useUpdates.getState()).toMatchObject({ phase: "available", availableVersion: "0.4.3", error: "offline" });
  });
  it("downloads with progress and defers installation while work needs confirmation", async () => {
    const service = await import("./updates");
    await service.checkForUpdates(); m.deferInstall = true;
    await service.installAvailableUpdate();
    expect(service.useUpdates.getState()).toMatchObject({ phase: "ready", downloaded: 100, total: 100 });
    expect(m.install).not.toHaveBeenCalled();
    // Cancelled confirmation: an explicit retry uses the downloaded package, never a second download.
    m.pendingGo = undefined;
    await service.installAvailableUpdate();
    expect(m.download).toHaveBeenCalledTimes(1);
    m.pendingGo!();
    await vi.waitFor(() => expect(m.relaunch).toHaveBeenCalledOnce());
    expect(m.flush.mock.invocationCallOrder[0]).toBeLessThan(m.install.mock.invocationCallOrder[0]!);
    expect(m.install).toHaveBeenCalledWith({ restartAfterInstall: true });
  });
  it("does not install or restart after a failed download and supports retry", async () => {
    const service = await import("./updates"); await service.checkForUpdates();
    m.download.mockRejectedValueOnce(new Error("Signatur ungültig"));
    await service.installAvailableUpdate();
    expect(m.install).not.toHaveBeenCalled(); expect(m.relaunch).not.toHaveBeenCalled();
    expect(service.useUpdates.getState()).toMatchObject({ phase: "error", availableVersion: "0.4.3" });
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(m.install).toHaveBeenCalledOnce());
  });
  it("keeps a downloaded update available if installation fails", async () => {
    const service = await import("./updates"); await service.checkForUpdates();
    m.install.mockRejectedValueOnce(new Error("Installer gesperrt"));
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(service.useUpdates.getState().phase).toBe("error"));
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(m.relaunch).toHaveBeenCalledOnce());
    expect(m.download).toHaveBeenCalledTimes(1);
  });
  it("does not run the installer if saving the vault fails", async () => {
    const service = await import("./updates"); await service.checkForUpdates();
    m.flush.mockRejectedValueOnce(new Error("Datenträger voll"));
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(service.useUpdates.getState().phase).toBe("error"));
    expect(m.install).not.toHaveBeenCalled();
  });
  it("checks at startup, every five minutes and when returning online or to the app, without duplicate timers", async () => {
    vi.useFakeTimers(); m.check.mockResolvedValue(null);
    const service = await import("./updates"); stop = service.startUpdateChecks(); service.startUpdateChecks();
    await vi.advanceTimersByTimeAsync(5000);
    await vi.dynamicImportSettled();
    await vi.waitFor(() => expect(m.check).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
    expect(m.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 5000);
    await vi.dynamicImportSettled();
    expect(m.check).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(0);
    await vi.dynamicImportSettled();
    expect(m.check).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(31_000);
    window.dispatchEvent(new Event("pageshow")); await vi.advanceTimersByTimeAsync(0);
    await vi.dynamicImportSettled();
    expect(m.check).toHaveBeenCalledTimes(4);
    document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0);
    expect(m.check).toHaveBeenCalledTimes(4);
  });
  it("does not contact operator releases from the community edition", async () => {
    m.allowed = false;
    const service = await import("./updates"); await service.checkForUpdates();
    expect(m.check).not.toHaveBeenCalled();
  });
});

describe("Mac updates", () => {
  it("offers the actual Mac build through the shared state and opens its installer", async () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh Mac OS X" });
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ version: "0.4.4", mac: { version: "0.4.3" } }) });
    const service = await import("./updates");
    await service.checkForUpdates();
    expect(service.useUpdates.getState()).toMatchObject({ mode: "mac", phase: "available", availableVersion: "0.4.3" });
    await service.installAvailableUpdate();
    expect(m.openUrl).toHaveBeenCalledWith("https://downloads.example.test/releases/v0.4.3/Ordo-macOS.dmg");
    expect(m.check).not.toHaveBeenCalled();
  });
});

describe("web updates", () => {
  it("detects a newer version before service-worker registration and supports browsers without it", async () => {
    m.desktop = false;
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ version: "0.4.3" }) });
    const service = await import("./updates");
    service.useUpdates.setState({ currentVersion: "0.4.2" });
    await service.checkForUpdates(); await service.checkForUpdates();
    expect(service.useUpdates.getState()).toMatchObject({ phase: "available", availableVersion: "0.4.3" });
    expect(m.fetch).toHaveBeenCalledWith(expect.stringContaining("version.json"), expect.objectContaining({ cache: "no-store" }));
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(m.reload).toHaveBeenCalledOnce());
    expect(m.flush.mock.invocationCallOrder[0]).toBeLessThan(m.reload.mock.invocationCallOrder[0]!);
  });
  it("offers a waiting worker even if version metadata fails and saves before reloading", async () => {
    m.desktop = false;
    const sw = Object.assign(new EventTarget(), { controller: {}, getRegistration: vi.fn() });
    vi.stubGlobal("navigator", { userAgent: "Chrome", serviceWorker: sw });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    m.refreshWeb.mockImplementation(async () => { sw.dispatchEvent(new Event("controllerchange")); });
    const registration = { waiting: {}, update: vi.fn().mockResolvedValue(undefined) };
    m.registerSW.mockImplementation((options) => { m.swOptions = options; options.onRegisteredSW("sw.js", registration); return m.refreshWeb; });
    const service = await import("./updates"); stop = service.startUpdateChecks();
    await vi.waitFor(() => expect(m.registerSW).toHaveBeenCalledOnce());
    await service.checkForUpdates();
    expect(service.useUpdates.getState().phase).toBe("available");
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(m.refreshWeb).toHaveBeenCalledWith(true));
    expect(m.flush.mock.invocationCallOrder[0]).toBeLessThan(m.refreshWeb.mock.invocationCallOrder[0]!);
    expect(m.reload).toHaveBeenCalledOnce();
  });
  it("waits for the new mobile worker to finish downloading before activating it", async () => {
    m.desktop = false;
    const sw = Object.assign(new EventTarget(), { controller: {}, getRegistration: vi.fn() });
    vi.stubGlobal("navigator", { userAgent: "iPhone", serviceWorker: sw });
    const worker = Object.assign(new EventTarget(), { state: "installing" });
    const reg = { waiting: null as unknown, installing: worker as unknown, update: vi.fn().mockResolvedValue(undefined) };
    m.registerSW.mockImplementation((options) => { m.swOptions = options; options.onRegisteredSW("sw.js", reg); return m.refreshWeb; });
    m.refreshWeb.mockImplementation(async () => { sw.dispatchEvent(new Event("controllerchange")); });
    const service = await import("./updates"); stop = service.startUpdateChecks();
    await vi.waitFor(() => expect(m.registerSW).toHaveBeenCalledOnce());
    service.useUpdates.setState({ phase: "available", availableVersion: "0.4.3" });
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(m.flush).toHaveBeenCalledOnce());
    expect(m.refreshWeb).not.toHaveBeenCalled();
    reg.waiting = worker; reg.installing = null; worker.state = "installed"; worker.dispatchEvent(new Event("statechange"));
    await vi.waitFor(() => expect(m.reload).toHaveBeenCalledOnce());
  });
  it("keeps another tab's update visible without unexpectedly reloading unfinished work", async () => {
    m.desktop = false;
    const sw = Object.assign(new EventTarget(), { controller: {}, getRegistration: vi.fn() });
    vi.stubGlobal("navigator", { userAgent: "Android", serviceWorker: sw });
    m.registerSW.mockImplementation((options) => { m.swOptions = options; return m.refreshWeb; });
    const service = await import("./updates"); stop = service.startUpdateChecks();
    await vi.waitFor(() => expect(m.registerSW).toHaveBeenCalledOnce());
    m.swOptions.onNeedReload();
    expect(m.reload).not.toHaveBeenCalled();
    expect(service.useUpdates.getState().phase).toBe("available");
    m.deferInstall = true; await service.installAvailableUpdate();
    expect(m.reload).not.toHaveBeenCalled();
    m.pendingGo!(); await vi.waitFor(() => expect(m.reload).toHaveBeenCalledOnce());
  });
  it("does not reload into an old cached app if the new worker is not ready yet", async () => {
    m.desktop = false;
    const sw = Object.assign(new EventTarget(), { controller: {}, getRegistration: vi.fn() });
    vi.stubGlobal("navigator", { userAgent: "Android", serviceWorker: sw });
    const reg = { waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined) };
    m.registerSW.mockImplementation((options) => { options.onRegisteredSW("sw.js", reg); return m.refreshWeb; });
    const service = await import("./updates"); stop = service.startUpdateChecks();
    await vi.waitFor(() => expect(m.registerSW).toHaveBeenCalledOnce());
    service.useUpdates.setState({ phase: "available", availableVersion: "0.4.3" });
    await service.installAvailableUpdate();
    await vi.waitFor(() => expect(service.useUpdates.getState().error).toContain("noch nicht vollständig bereit"));
    expect(service.useUpdates.getState().phase).toBe("available");
    expect(m.reload).not.toHaveBeenCalled();
  });
  it("retains the advertised version after an offline check and after a failed save", async () => {
    m.desktop = false;
    const service = await import("./updates");
    service.useUpdates.setState({ phase: "available", availableVersion: "0.4.3" });
    m.fetch.mockRejectedValue(new Error("offline")); await service.checkForUpdates();
    expect(service.useUpdates.getState()).toMatchObject({ phase: "available", availableVersion: "0.4.3" });
    m.flush.mockRejectedValue(new Error("Speicher voll")); await service.installAvailableUpdate();
    await vi.waitFor(() => expect(service.useUpdates.getState().error).toBe("Speicher voll"));
    expect(m.reload).not.toHaveBeenCalled();
  });
});

describe("version comparison", () => {
  it("compares versions numerically and handles pre-release versions", async () => {
    const { isNewerVersion: newer } = await import("./updates");
    expect(newer("0.4.10", "0.4.9")).toBe(true);
    expect(newer("0.4.3", "0.4.3-beta.2")).toBe(true);
    expect(newer("0.4.3-beta.10", "0.4.3-beta.2")).toBe(true);
    expect(newer("0.4.3-beta.2", "0.4.3")).toBe(false);
    expect(newer("0.4.3", "0.4.3")).toBe(false);
    expect(newer("garbage", "0.4.2")).toBe(false);
  });
});
