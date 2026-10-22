/**
 * Field checks for forms – short German messages, undefined when the value is fine or empty (required fields are
 * checked separately). Used by contacts, team, company data and every other form that takes these values.
 */

/** IBAN incl. the mod-97 check digits (ISO 13616). */
export function ibanError(raw: string): string | undefined {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!iban) return undefined;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return "Eine IBAN beginnt mit dem Land und zwei Ziffern, z. B. AT61 1904 …";
  if (iban.startsWith("AT") && iban.length !== 20) return "Eine österreichische IBAN hat 20 Zeichen.";
  if (iban.startsWith("DE") && iban.length !== 22) return "Eine deutsche IBAN hat 22 Zeichen.";
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (let i = 0; i < digits.length; i += 7) rest = Number(String(rest) + digits.slice(i, i + 7)) % 97;
  return rest === 1 ? undefined : "Die Prüfziffer passt nicht – bitte die IBAN kontrollieren.";
}

/** UID / VAT number (Umsatzsteuer-Identifikationsnummer). */
export function uidError(raw: string): string | undefined {
  const uid = raw.replace(/[\s.-]+/g, "").toUpperCase();
  if (!uid) return undefined;
  if (uid.startsWith("AT")) return /^ATU\d{8}$/.test(uid) ? undefined : "Eine österreichische UID sieht so aus: ATU12345678.";
  if (uid.startsWith("DE")) return /^DE\d{9}$/.test(uid) ? undefined : "Eine deutsche USt-IdNr. sieht so aus: DE123456789.";
  return /^[A-Z]{2}[A-Z0-9+*]{8,12}$/.test(uid) ? undefined : "Eine UID beginnt mit dem Länderkürzel, z. B. ATU12345678.";
}

export function emailError(raw: string): string | undefined {
  const e = raw.trim();
  if (!e) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? undefined : "Das ist keine gültige E-Mail-Adresse.";
}

export function phoneError(raw: string): string | undefined {
  const p = raw.trim();
  if (!p) return undefined;
  return /^\+?[\d\s/()-]{6,}$/.test(p) ? undefined : "Nur Ziffern, Leerzeichen und + / ( ) -.";
}

export function countryError(raw: string): string | undefined {
  const c = raw.trim();
  if (!c) return undefined;
  return /^[A-Z]{2}$/.test(c.toUpperCase()) ? undefined : "Zwei Buchstaben, z. B. AT, DE, CH.";
}

export function zipError(raw: string, country: string): string | undefined {
  const z = raw.trim();
  if (!z) return undefined;
  const c = country.trim().toUpperCase() || "AT";
  if (["AT", "CH", "LI", "HU", "SI", "BE", "DK", "LU"].includes(c)) return /^\d{4}$/.test(z) ? undefined : "Die Postleitzahl hat hier 4 Ziffern.";
  if (["DE", "IT", "FR", "ES", "FI"].includes(c)) return /^\d{5}$/.test(z) ? undefined : "Die Postleitzahl hat hier 5 Ziffern.";
  return /^[A-Z0-9 -]{3,10}$/i.test(z) ? undefined : "Diese Postleitzahl sieht ungewöhnlich aus.";
}

export function websiteError(raw: string): string | undefined {
  const w = raw.trim();
  if (!w) return undefined;
  return /^(https?:\/\/)?[\p{L}\d-]+(\.[\p{L}\d-]+)+(:\d+)?(\/\S*)?$/u.test(w) ? undefined : "Zum Beispiel muster.at oder https://www.muster.at.";
}

/** First error of a record of checks – handy for "Speichern" buttons. */
export function firstError(errors: Record<string, string | undefined>): string | undefined {
  return Object.values(errors).find(Boolean);
}

/** IBAN in groups of four, as people write it. */
export function formatIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}
