/**
 * Runs the connections while Ordo is unlocked: the local API (Desktop), webhooks shortly after something changed, timed
 * pulls (SAP, REST). Automatic runs happen only on the device the connection belongs to (deviceId), so two open
 * devices never send or import twice; by hand ("Jetzt abgleichen") works everywhere.
 */
import { create } from "zustand";
import type { Integration, VaultStore } from "@ordo/core";
import { getPlatform, isTauri } from "@/platform";
import { activeApiTokens, handleLocalApi } from "./localApi";
import { deliverWebhook, pingWebhook } from "./webhooks";
import { runSapB1, testSapB1 } from "./sapB1";
import { probeRest, runRestPull } from "./restPull";
import { integrationById, logRun } from "./registry";

interface RuntimeState {
  apiRunning: boolean;
  apiPort?: number;
  apiError?: string;
  busy: Record<string, boolean>;
}

export const useIntegrationRuntime = create<RuntimeState>(() => ({ apiRunning: false, busy: {} }));

const setBusy = (id: string, on: boolean) => useIntegrationRuntime.setState((s) => ({ busy: { ...s.busy, [id]: on } }));

function thisDevice(store: VaultStore): string {
  return store.vault.settings.sync.deviceId || "";
}

/** Whether automatic runs of this connection belong on this device. */
export function runsHere(store: VaultStore, i: Integration): boolean {
  return !i.deviceId || !thisDevice(store) || i.deviceId === thisDevice(store);
}

/** "Jetzt abgleichen" / "Jetzt senden". Returns a short German result. */
export async function runIntegration(store: VaultStore, id: string): Promise<string> {
  const i = integrationById(id);
  if (!i) throw new Error("Verbindung nicht gefunden.");
  setBusy(id, true);
  try {
    if (i.kind === "webhook") {
      const n = await deliverWebhook(store, i);
      return n ? `${n} Änderungen gesendet.` : "Nichts Neues zu senden.";
    }
    if (i.kind === "sap_b1" || i.kind === "rest_pull") {
      try {
        const r = i.kind === "sap_b1" ? await runSapB1(store, i) : await runRestPull(store, i);
        logRun(id, true, r.message);
        return r.message;
      } catch (e) {
        logRun(id, false, e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
    return "Ein API-Schlüssel läuft von selbst, sobald ein Programm ihn benutzt.";
  } finally {
    setBusy(id, false);
  }
}

/** "Testen": checks access without changing anything in Ordo. */
export async function testIntegration(id: string): Promise<string> {
  const i = integrationById(id);
  if (!i) throw new Error("Verbindung nicht gefunden.");
  setBusy(id, true);
  try {
    if (i.kind === "webhook") {
      await pingWebhook(i);
      return "Test-Nachricht gesendet – im Empfänger sollte ein „ping“ ankommen.";
    }
    const message = i.kind === "sap_b1" ? (await testSapB1(i)).message : i.kind === "rest_pull" ? await probeRest(i).then((p) => `${p.count} Datensätze gefunden${p.itemsPath ? ` unter „${p.itemsPath}“` : ""}, ${p.fields.length} Felder.`) : "Nichts zu testen.";
    logRun(id, true, `Test: ${message}`);
    return message;
  } catch (e) {
    logRun(id, false, `Test: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    setBusy(id, false);
  }
}

/**
 * Starts everything for an unlocked vault; the returned function stops it again (lock, sign-out).
 */
export function startIntegrations(store: VaultStore): () => void {
  let stopped = false;
  let unlisten: (() => void) | undefined;
  let lastTokens = "";
  let lastApi = "";
  const failures = new Map<string, number>();
  let webhookTimer: ReturnType<typeof setTimeout> | undefined;

  const syncApi = async () => {
    if (!isTauri || stopped) return;
    const platform = await getPlatform();
    if (!platform.localApi) return;
    const { enabled, port } = store.vault.settings.localApi;
    const want = enabled ? `on:${port}` : "off";
    const tokens = activeApiTokens();
    try {
      if (want !== lastApi) {
        lastApi = want;
        if (enabled) {
          await platform.localApi.start(port, tokens);
          lastTokens = tokens.join("|");
          unlisten ??= await platform.localApi.onRequest(handleLocalApi);
          useIntegrationRuntime.setState({ apiRunning: true, apiPort: port, apiError: undefined });
        } else {
          await platform.localApi.stop();
          useIntegrationRuntime.setState({ apiRunning: false, apiPort: undefined, apiError: undefined });
        }
      } else if (enabled && tokens.join("|") !== lastTokens) {
        lastTokens = tokens.join("|");
        await platform.localApi.setTokens(tokens);
      }
    } catch (e) {
      lastApi = "";
      useIntegrationRuntime.setState({ apiRunning: false, apiError: e instanceof Error ? e.message : String(e) });
    }
  };

  const tick = async () => {
    if (stopped) return;
    const now = Date.now();
    for (const i of store.vault.settings.integrations ?? []) {
      if (!i.enabled || !runsHere(store, i) || useIntegrationRuntime.getState().busy[i.id]) continue;
      // after a failure wait a little longer each time (1, 2, 4 … up to 60 minutes)
      const fails = failures.get(i.id) ?? 0;
      const last = i.lastRunAt ? Date.parse(i.lastRunAt) : 0;
      if (fails && now - last < Math.min(60, 2 ** (fails - 1)) * 60_000) continue;
      const due = i.kind === "webhook" ? !!i.url : (i.kind === "sap_b1" || i.kind === "rest_pull") && i.everyMinutes > 0 && now - last >= i.everyMinutes * 60_000;
      if (!due) continue;
      try {
        await runIntegration(store, i.id);
        failures.delete(i.id);
      } catch {
        failures.set(i.id, fails + 1);
      }
    }
  };

  const unsubscribe = store.subscribe(() => {
    void syncApi();
    // webhooks a few seconds after a change, so a burst of edits goes out as one batch
    if (webhookTimer) clearTimeout(webhookTimer);
    webhookTimer = setTimeout(() => void tick(), 4000);
  });
  void syncApi();
  const interval = setInterval(() => void tick(), 60_000);
  setTimeout(() => void tick(), 8000);

  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(interval);
    if (webhookTimer) clearTimeout(webhookTimer);
    unlisten?.();
    if (isTauri) void getPlatform().then((p) => p.localApi?.stop());
    useIntegrationRuntime.setState({ apiRunning: false, apiPort: undefined });
  };
}
