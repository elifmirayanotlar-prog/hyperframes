import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
const workflowsDir = join(root, ".github", "workflows");
const load = (path) => parse(readFileSync(path, "utf8"));
const workflows = readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({ file, doc: load(join(workflowsDir, file)) }));
const events = (on) =>
  typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});

// The Actions cache holds 10 GB; per-PR image exports evict the bun cache and leave installs cold.
test("only pushes to main write image layers to the Actions cache", () => {
  const dispatchOnly = ["fast-video-validation.yml"];
  for (const file of dispatchOnly) {
    const { doc } = workflows.find((w) => w.file === file);
    assert.deepEqual(events(doc.on), ["workflow_dispatch"], `${file} must stay dispatch-only`);
  }
  const ungated = [];
  for (const { file, doc } of workflows) {
    if (dispatchOnly.includes(file)) continue;
    for (const [name, job] of Object.entries(doc.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const cacheTo = String(step.with?.["cache-to"] ?? "");
        if (cacheTo.includes("type=gha") && !cacheTo.includes("github.event_name == 'push'")) {
          ungated.push(`${file} ${name}`);
        }
      }
    }
  }
  assert.deepEqual(ungated, []);
});

test("preflight installs without downloading ffmpeg or Chrome", () => {
  const steps = load(join(root, ".github", "actions", "preflight", "action.yml")).runs.steps;
  const ffmpeg = steps.findIndex((step) => step.uses === "./.github/actions/prepare-ffmpeg-bin");
  const install = steps.findIndex((step) => /\bbun install\b/.test(step.run ?? ""));
  assert.ok(install >= 0, "preflight runs bun install");
  assert.ok(ffmpeg >= 0 && ffmpeg < install, "prepare-ffmpeg-bin runs before bun install");
  assert.equal(steps[install].env?.PUPPETEER_SKIP_DOWNLOAD, "true");
});
