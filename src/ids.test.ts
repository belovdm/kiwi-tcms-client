import { describe, expect, it } from "vitest";
import { extractId, extractName, firstId } from "./ids.js";

describe("extractId", () => {
  it("returns finite numbers as-is", () => {
    expect(extractId(12)).toBe(12);
  });

  it("parses numeric strings", () => {
    expect(extractId("34")).toBe(34);
  });

  it("walks nested id and pk objects", () => {
    expect(extractId({ id: "7" })).toBe(7);
    expect(extractId({ pk: 9 })).toBe(9);
    expect(extractId({ id: { pk: "11" } })).toBe(11);
  });

  it("returns undefined for empty or invalid values", () => {
    expect(extractId(undefined)).toBeUndefined();
    expect(extractId(null)).toBeUndefined();
    expect(extractId("abc")).toBeUndefined();
    expect(extractId(Number.NaN)).toBeUndefined();
    expect(extractId({})).toBeUndefined();
  });
});

describe("extractName", () => {
  it("returns strings as-is", () => {
    expect(extractName("PASSED")).toBe("PASSED");
  });

  it("reads name or value from objects", () => {
    expect(extractName({ name: "Failed" })).toBe("Failed");
    expect(extractName({ value: "Medium" })).toBe("Medium");
  });

  it("returns undefined when no name is present", () => {
    expect(extractName(12)).toBeUndefined();
    expect(extractName({ id: 1 })).toBeUndefined();
    expect(extractName(undefined)).toBeUndefined();
  });
});

describe("firstId", () => {
  it("reads the first numeric row", () => {
    expect(firstId([5, 6])).toBe(5);
  });

  it("reads id from the first object row", () => {
    expect(firstId([{ id: 3 }, { id: 4 }])).toBe(3);
  });

  it("returns undefined for empty input", () => {
    expect(firstId(undefined)).toBeUndefined();
    expect(firstId([])).toBeUndefined();
  });
});
