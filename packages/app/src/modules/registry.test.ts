import { describe, expect, it } from "vitest";
import { SettingsSchema } from "@ordo/core";
import { isAllowed, isInstalled, moduleById } from "./registry";

describe("accounting core and optional add-ons", () => {
  it("keeps accounting available when an older workspace stored it as uninstalled or disabled", () => {
    const settings = SettingsSchema.parse({ modules: { summa: { installed: false } } });
    expect(isInstalled(settings, moduleById("summa")!)).toBe(true);
    expect(isAllowed({ summa: false }, "summa")).toBe(true);
  });

  it("starts add-ons disabled and still respects their stored activation and access settings", () => {
    const project = moduleById("projekte")!;
    expect(isInstalled(SettingsSchema.parse({}), project)).toBe(false);
    expect(isInstalled(SettingsSchema.parse({ modules: { projekte: { installed: true } } }), project)).toBe(true);
    expect(isAllowed({ projekte: false }, "projekte")).toBe(false);
  });
});
