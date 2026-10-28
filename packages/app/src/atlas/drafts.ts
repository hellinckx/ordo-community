/*
 * What someone has typed but not sent yet, per chat ("<profile>:new" for a chat not started). Kept in this window's
 * session storage only: it survives switching chats and reloads, never reaches the disk unencrypted for long, is gone
 * when the window closes and is cleared when the vault is locked.
 */
const PREFIX = "ordo.atlas.draft.";
const MAX_AGE = 14 * 24 * 3600_000;

export function loadDraft(key: string): string {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return "";
    const d = JSON.parse(raw) as { text?: string; at?: number };
    return d.at && Date.now() - d.at < MAX_AGE ? (d.text ?? "") : "";
  } catch {
    return "";
  }
}

export function saveDraft(key: string, text: string) {
  try {
    if (text.trim()) sessionStorage.setItem(PREFIX + key, JSON.stringify({ text, at: Date.now() }));
    else sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* storage full or blocked – the text stays in the field until the page closes */
  }
}

export function dropDraft(key: string) {
  saveDraft(key, "");
}

export function clearDrafts() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* nothing stored */
  }
}
