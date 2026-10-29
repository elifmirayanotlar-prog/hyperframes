import { createHash } from "node:crypto";
import type { UserInfo } from "./client.js";

/**
 * Who a signed-in install is in telemetry. `distinctId` is the PostHog person
 * key; `traits` are person properties ($set) shared across HeyGen's PostHog
 * projects so the Snowflake event table can join one person across them.
 */
export interface TelemetryIdentity {
  distinctId: string;
  traits: Record<string, string>;
}

/**
 * The HyperFrames user id for a HeyGen username: the same sha256-derived UUID
 * (version nibble 5, RFC 4122 variant) the HyperFrames web app and Desktop key
 * their users and PostHog persons on, so CLI usage lands on the same person.
 */
export function heygenUserId(username: string): string {
  const hash = createHash("sha256").update(username).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Keyed on the username's HyperFrames user id. An account with no username
 * falls back to its lowercased email, the key earlier CLI versions used.
 * `heygen_username` is the cross-project join column (HeyGen's own project
 * stores the same value as `name`).
 */
export function telemetryIdentity(user: UserInfo): TelemetryIdentity | undefined {
  const email = user.email?.trim().toLowerCase() || undefined;
  const username = user.username?.trim() ? user.username : undefined;
  const traits: Record<string, string> = {};
  if (email) traits.email = email;
  if (username) traits.heygen_username = username;
  if (username) return { distinctId: heygenUserId(username), traits };
  if (email) return { distinctId: email, traits };
  return undefined;
}
