import { describe, expect, it } from "vitest";
import { composeCaseText, parseCaseText } from "./case-text.js";

describe("composeCaseText", () => {
  it("joins setup, steps, expected, and breakdown into Kiwi markdown text", () => {
    expect(
      composeCaseText({
        setup: "App is open.",
        actions: "1. Click Add",
        expected: "Item appears",
        breakdown: "Reset list",
      }),
    ).toBe(
      "## Setup\nApp is open.\n\n## Steps\n1. Click Add\n\n## Expected\nItem appears\n\n## Breakdown\nReset list",
    );
  });

  it("omits empty sections", () => {
    expect(composeCaseText({ expected: "Visible" })).toBe("## Expected\nVisible");
  });

  it("returns an empty string when every section is empty", () => {
    expect(composeCaseText({})).toBe("");
    expect(composeCaseText({ setup: "  ", actions: "" })).toBe("");
  });
});

describe("parseCaseText", () => {
  it("splits Kiwi markdown text back into setup, actions, expected, and breakdown", () => {
    expect(
      parseCaseText(
        "## Setup\nApp is open.\n\n## Steps\n1. Click Add\n\n## Expected\nItem appears\n\n## Breakdown\nReset list",
      ),
    ).toEqual({
      setup: "App is open.",
      actions: "1. Click Add",
      expected: "Item appears",
      breakdown: "Reset list",
    });
  });

  it("treats ## Actions as steps", () => {
    expect(parseCaseText("## Actions\nClick Save")).toEqual({
      setup: "",
      actions: "Click Save",
      expected: "",
      breakdown: "",
    });
  });

  it("leaves structured fields empty when there are no headings", () => {
    expect(parseCaseText("just a paragraph")).toEqual({
      setup: "",
      actions: "",
      expected: "",
      breakdown: "",
    });
  });
});
