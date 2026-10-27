import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotsOnDisk } from "./snapshot.js";

describe("snapshotsOnDisk", () => {
  it("counts only the stills that exist with bytes, and names the others", () => {
    const project = mkdtempSync(join(tmpdir(), "hf-snap-disk-"));
    mkdirSync(join(project, "shots"));
    writeFileSync(join(project, "shots", "a.png"), "png");
    writeFileSync(join(project, "shots", "empty.png"), "");
    const result = snapshotsOnDisk(
      project,
      ["shots/a.png", "shots/empty.png", "shots/gone.png"],
      3,
    );
    expect(result.written).toEqual([join(project, "shots", "a.png")]);
    expect(result.missing).toEqual([
      join(project, "shots", "empty.png"),
      join(project, "shots", "gone.png"),
    ]);
    expect(result.requested).toBe(3);
  });

  it("resolves a project-relative path against the project, not the caller's directory", () => {
    const project = mkdtempSync(join(tmpdir(), "hf-snap-disk-"));
    const elsewhere = mkdtempSync(join(tmpdir(), "hf-snap-cwd-"));
    writeFileSync(join(project, "frame.png"), "png");
    const before = process.cwd();
    process.chdir(elsewhere);
    try {
      expect(snapshotsOnDisk(project, ["frame.png"], 1).written).toEqual([
        join(project, "frame.png"),
      ]);
    } finally {
      process.chdir(before);
    }
  });

  it("keeps an absolute path as it is", () => {
    const folder = mkdtempSync(join(tmpdir(), "hf-snap-abs-"));
    writeFileSync(join(folder, "x.png"), "png");
    expect(snapshotsOnDisk("/not/the/project", [join(folder, "x.png")], 1).written).toHaveLength(1);
  });
});
