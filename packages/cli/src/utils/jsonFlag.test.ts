import { describe, expect, it } from "vitest";
import { readJsonFlag } from "./jsonFlag.js";

const io = {
  readFile: (path: string) => {
    if (path !== "g.json") throw new Error("ENOENT: no such file");
    return '{"preset":"warm-daylight"}';
  },
  readStdin: () => '{"preset":"skin-soft"}',
};

describe("readJsonFlag", () => {
  it("reads inline JSON, a file path and - for stdin the same way", () => {
    expect(readJsonFlag("--grading", '{"preset":"a"}', io)).toEqual({ preset: "a" });
    expect(readJsonFlag("--grading", "g.json", io)).toEqual({ preset: "warm-daylight" });
    expect(readJsonFlag("--grading", "-", io)).toEqual({ preset: "skin-soft" });
  });

  it("points the quote-stripped value PowerShell passes at the file and stdin forms", () => {
    expect(() => readJsonFlag("--grading", "{preset:skin-soft,intensity:0.6}", io)).toThrow(
      /PowerShell.*--grading payload\.json.*--grading -/,
    );
  });

  it("names the flag and path when the file cannot be read", () => {
    expect(() => readJsonFlag("--grading", "missing.json", io)).toThrow(
      /Could not read --grading: missing\.json: ENOENT/,
    );
  });
});
