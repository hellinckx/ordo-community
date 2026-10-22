import { describe, expect, it } from "vitest";
import { countryError, emailError, firstError, formatIban, ibanError, phoneError, uidError, websiteError, zipError } from "./validate";

describe("form checks", () => {
  it("checks IBANs with their check digits", () => {
    expect(ibanError("AT61 1904 3002 3457 3201")).toBeUndefined();
    expect(ibanError("DE89370400440532013000")).toBeUndefined();
    expect(ibanError("AT61 1904 3002 3457 3202")).toMatch(/Prüfziffer/);
    expect(ibanError("AT61 1904")).toMatch(/IBAN|20 Zeichen/);
    expect(ibanError("")).toBeUndefined();
    expect(formatIban("at611904300234573201")).toBe("AT61 1904 3002 3457 3201");
  });

  it("checks UID numbers per country", () => {
    expect(uidError("ATU12345678")).toBeUndefined();
    expect(uidError("atu 1234 5678")).toBeUndefined();
    expect(uidError("AT12345678")).toMatch(/ATU/);
    expect(uidError("DE123456789")).toBeUndefined();
    expect(uidError("IE4276970QH")).toBeUndefined();
    expect(uidError("12345")).toMatch(/Länderkürzel/);
  });

  it("checks e-mail, phone, country, postcode and website", () => {
    expect(emailError("office@muster.at")).toBeUndefined();
    expect(emailError("office@muster")).toBeDefined();
    expect(phoneError("+43 1 234 56 78")).toBeUndefined();
    expect(phoneError("Büro")).toBeDefined();
    expect(countryError("at")).toBeUndefined();
    expect(countryError("Österreich")).toBeDefined();
    expect(zipError("7000", "AT")).toBeUndefined();
    expect(zipError("70000", "AT")).toBeDefined();
    expect(zipError("10115", "DE")).toBeUndefined();
    expect(websiteError("muster.at")).toBeUndefined();
    expect(websiteError("https://www.müller-bau.at/kontakt")).toBeUndefined();
    expect(websiteError("keine website")).toBeDefined();
    expect(firstError({ a: undefined, b: "x", c: "y" })).toBe("x");
  });
});
