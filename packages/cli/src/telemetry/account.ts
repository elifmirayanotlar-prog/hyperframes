import { readFileSync } from "node:fs";
import { credentialPath } from "../auth/paths.js";

// The signed-in account, sent as `$user_id` on every event so signed-in usage is
// selectable per row. Same key `identifyUser` sends, read from the saved user block.

// undefined: not read yet; null: nobody signed in.
let cached: string | null | undefined;

export function signedInAccountId(): string | undefined {
  if (cached === undefined) cached = readStoredAccountId();
  return cached ?? undefined;
}

export function setSignedInAccountId(id: string): void {
  cached = id.length > 0 ? id : null;
}

export function resetSignedInAccountCache(): void {
  cached = undefined;
}

function readStoredAccountId(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialPath(), "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.user)) return null;
    const { email, username } = parsed.user;
    if (typeof email === "string" && email.length > 0) return email;
    if (typeof username === "string" && username.length > 0) return username;
    return null;
  } catch {
    // Absent, legacy plaintext or malformed: nobody to attribute, and telemetry never throws.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
