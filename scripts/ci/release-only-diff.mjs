#!/usr/bin/env node
// Says whether a pull request changes only a release's own files: manifest versions, release notes, the changelog.
//   node scripts/ci/release-only-diff.mjs [--base <ref, default HEAD^1>] [--verify]   writes release_only= to $GITHUB_OUTPUT
// --verify also exits 1 when the release is inconsistent: mixed versions, no notes, an unreviewed TODO, no changelog entry.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFESTS = new Set(["package.json", "plugin.json", "gemini-extension.json"]);
const RELEASE_NOTES = /^releases\/v\d+\.\d+\.\d+[^/]*\.md$/;
const CHANGELOG = "docs/changelog.mdx";
const UNREVIEWED = ["<!-- TODO: write a 1-2 sentence release summary here. -->", "<!-- Style bar:"];

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The manifest with its version taken out, or null when it is not JSON. */
function withoutVersion(text) {
  try {
    const { version, ...rest } = JSON.parse(text);
    return { version, rest };
  } catch {
    return null;
  }
}

/**
 * Sorts changed paths into the release's own and the rest.
 * @param {string[]} paths @param {(path: string) => string | null} before @param {(path: string) => string | null} after
 * @returns {{ releaseOnly: boolean, other: string[], versions: Map<string, string> }}
 */
export function classify(paths, before, after) {
  const other = [];
  const versions = new Map();
  for (const path of paths) {
    if (RELEASE_NOTES.test(path) || path === CHANGELOG) continue;
    if (MANIFESTS.has(basename(path))) {
      const was = before(path) === null ? null : withoutVersion(before(path));
      const now = after(path) === null ? null : withoutVersion(after(path));
      if (was && now && sameJson(was.rest, now.rest) && was.version !== now.version) {
        versions.set(path, now.version);
        continue;
      }
    }
    other.push(path);
  }
  return { releaseOnly: paths.length > 0 && other.length === 0, other, versions };
}

/** Problems with a release that is otherwise only versions and notes; empty when it is consistent. */
export function verifyRelease({ versions }, after) {
  const problems = [];
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    problems.push(
      `manifests move to different versions: ${[...distinct].join(", ") || "none changed"}`,
    );
    return problems;
  }
  const [version] = distinct;
  const notes = after(`releases/v${version}.md`);
  if (notes === null) problems.push(`releases/v${version}.md is missing`);
  else if (UNREVIEWED.some((marker) => notes.includes(marker)))
    problems.push(`releases/v${version}.md still has the generated TODO or style note`);
  const changelog = after(CHANGELOG);
  if (changelog === null || !changelog.includes(`label="HyperFrames v${version}"`))
    problems.push(`${CHANGELOG} has no entry for v${version}`);
  else if (UNREVIEWED.some((marker) => changelog.includes(marker)))
    problems.push(`${CHANGELOG} still has the generated TODO or style note`);
  return problems;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
const show = (ref) => (path) => {
  try {
    return git("show", `${ref}:${path}`);
  } catch {
    return null;
  }
};

function main(argv) {
  const at = argv.indexOf("--base");
  const base = at >= 0 ? argv[at + 1] : "HEAD^1";
  const paths = git("-c", "core.quotePath=false", "diff", "--name-only", `${base}..HEAD`)
    .split("\n")
    .filter(Boolean);
  const result = classify(paths, show(base), show("HEAD"));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `release_only=${result.releaseOnly}\n`);
  console.log(
    result.releaseOnly
      ? `release only: ${paths.length} files, versions and notes`
      : `not release only: ${result.other.slice(0, 5).join(", ") || "no changed files"}`,
  );
  if (!argv.includes("--verify")) return 0;
  if (!result.releaseOnly) {
    console.error(
      "--verify applies to a release diff; this one carries more than versions and notes.",
    );
    return 1;
  }
  const problems = verifyRelease(result, show("HEAD"));
  for (const problem of problems) console.error(`::error::${problem}`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
