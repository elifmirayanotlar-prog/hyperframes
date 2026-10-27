import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchManagedBrowser } from "./launch.js";

function fakeBrowser(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "hf-fake-chrome-")), "chrome");
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe.runIf(process.platform !== "win32")("a browser that dies at startup", () => {
  it("fails the launch with its exit code and last stderr lines, not just 'Target closed'", async () => {
    const executablePath = fakeBrowser(
      'process.stderr.write("[1:1:FATAL:headless_shell] out of memory\\n"); process.exit(7);',
    );
    const puppeteer = (await import("puppeteer-core")).default;
    const failure = await launchManagedBrowser(puppeteer, {
      executablePath,
      headless: true,
      args: [],
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain("exited with code 7");
    expect(failure?.message).toContain("out of memory");
    expect(failure?.cause).toBeInstanceOf(Error);
  }, 60_000);
});
