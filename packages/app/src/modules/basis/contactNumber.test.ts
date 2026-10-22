import { describe, expect, it } from "vitest";
import { nextContactNumber } from "./contactNumber";

describe("nextContactNumber", () => {
  it("starts at K-0001", () => {
    expect(nextContactNumber([])).toBe("K-0001");
    expect(nextContactNumber([{ number: undefined }, { number: "" }])).toBe("K-0001");
  });
  it("continues after the highest K-number and ignores other formats", () => {
    expect(nextContactNumber([{ number: "K-0002" }, { number: "K-0010" }, { number: "Lief-99" }, { number: "k12" }])).toBe("K-0013");
  });
  it("keeps going beyond four digits", () => {
    expect(nextContactNumber([{ number: "K-9999" }])).toBe("K-10000");
  });
});
