import type { CodexBridge, StorageAdapter } from "@ordo/core";

export interface PickedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** Original path on disk (desktop only). */
  path?: string;
}

export interface WatchedFile {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export interface WatchOptions {
  /** Include sub folders (hidden ones and "Verarbeitet" are always skipped). */
  recursive?: boolean;
}

export interface FolderWatch {
  scan(path: string, opts?: WatchOptions): Promise<WatchedFile[]>;
  start(path: string, onFile: (f: WatchedFile) => void, opts?: WatchOptions): Promise<void>;
  stop(path: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  moveToProcessed(path: string): Promise<string>;
}

export interface BackupInfo {
  name: string;
  path: string;
  bytes: number;
  modified: number;
}

/** Outgoing HTTP through the desktop shell (no CORS, no CSP limits) – for connections the person set up. */
export interface NetRequest {
  method: string;
  url: string;
  headers?: [string, string][];
  body?: Uint8Array | string;
  timeoutMs?: number;
}

export interface NetResponse {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
}

/** A request another program sent to the local API (Desktop, 127.0.0.1). The key was already checked by Rust. */
export interface LocalApiRequest {
  id: string;
  method: string;
  path: string;
  query: string;
  body: string;
  token: string;
}

export interface LocalApiBridge {
  start(port: number, tokens: string[]): Promise<void>;
  stop(): Promise<void>;
  setTokens(tokens: string[]): Promise<void>;
  status(): Promise<{ running: boolean; port?: number }>;
  /** One handler for every request; returns the unsubscribe function. */
  onRequest(handler: (req: LocalApiRequest) => Promise<{ status: number; body: unknown }>): Promise<() => void>;
}

export interface Platform {
  kind: "tauri" | "web";
  storage: StorageAdapter;
  pickFiles(opts?: { multiple?: boolean; accept?: string[]; capture?: boolean }): Promise<PickedFile[]>;
  pickFolder(): Promise<string | null>;
  saveFile(name: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  notify(title: string, body: string): Promise<void>;
  requestNotificationPermission(): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  appInfo(): Promise<{ version: string; dataDir?: string; vaultPath?: string }>;
  revealDataDir?(): Promise<void>;
  codex?: CodexBridge;
  watch?: FolderWatch;
  backups?: { list(): Promise<BackupInfo[]>; restore(path: string): Promise<void> };
  /** Desktop: HTTP to any host the person configured (webhooks, ERP APIs, self-hosted Supabase). */
  net?: { fetch(req: NetRequest): Promise<NetResponse> };
  /** Desktop: the local API for other programs on this computer. */
  localApi?: LocalApiBridge;
  /** Deletes the whole vault (after explicit confirmation in the UI). */
  wipe(): Promise<void>;
}
