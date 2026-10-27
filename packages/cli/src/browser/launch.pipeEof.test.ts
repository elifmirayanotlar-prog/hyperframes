import { spawn } from "node:child_process";
import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { expect, it } from "vitest";
import { launchManagedBrowser } from "./launch.js";

// A helper that outlives the browser keeps the CDP pipe's far end open, like Chrome's crashpad handler.
const SPAWN_ORPHAN = `
  require("node:child_process")
    .spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], { detached: true, stdio: ["ignore", "ignore", "ignore", 3, 4] })
    .unref();
`;

it("closes the CDP pipe sockets when the browser exits, so an orphaned helper cannot hold the CLI open", async () => {
  const child = spawn(process.execPath, ["-e", SPAWN_ORPHAN], {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
  });
  const puppeteer = {
    launch: async (_options: LaunchOptions) => ({ process: () => child }),
  } as unknown as PuppeteerNode;
  await launchManagedBrowser(puppeteer, { headless: true }, { diagnose: false });
  const [, , , pipeWrite, pipeRead] = child.stdio;
  await expect
    .poll(() => pipeRead?.destroyed && pipeWrite?.destroyed, { timeout: 3000 })
    .toBe(true);
});
