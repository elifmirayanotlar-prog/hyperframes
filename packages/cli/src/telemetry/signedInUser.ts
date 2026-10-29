import { readFileSync, statSync } from "node:fs";
import { credentialPath } from "../auth/paths.js";

let cached: { path: string; mtimeMs: number; username: string | undefined } | undefined;

function usernameOf(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const user = (parsed as { user?: unknown }).user;
  if (!user || typeof user !== "object") return undefined;
  const name = (user as { username?: unknown }).username;
  return typeof name === "string" && name.trim() ? name : undefined;
}

/** The signed-in HeyGen username, put on every event so each row joins across projects by itself. */
export function signedInHeygenUsername(): string | undefined {
  const path = credentialPath();
  try {
    const { mtimeMs } = statSync(path);
    if (cached?.path === path && cached.mtimeMs === mtimeMs) return cached.username;
    const username = usernameOf(JSON.parse(readFileSync(path, "utf8")));
    cached = { path, mtimeMs, username };
    return username;
  } catch {
    cached = undefined;
    return undefined;
  }
}
