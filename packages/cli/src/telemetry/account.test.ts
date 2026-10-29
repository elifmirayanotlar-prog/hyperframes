import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSignedInAccountCache, setSignedInAccountId, signedInAccountId } from "./account.js";

let dir: string;

function writeCredentials(contents: string): void {
  writeFileSync(join(dir, "credentials"), contents);
}

describe("signedInAccountId", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-account-"));
    vi.stubEnv("HEYGEN_CONFIG_DIR", dir);
    resetSignedInAccountCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    resetSignedInAccountCache();
  });

  it("is the account email from the saved sign-in", () => {
    writeCredentials(
      JSON.stringify({
        oauth: { access_token: "t" },
        user: { email: "alice@example.com", username: "alice" },
      }),
    );
    expect(signedInAccountId()).toBe("alice@example.com");
  });

  it("falls back to the username when the account has no email", () => {
    writeCredentials(JSON.stringify({ api_key: "hg_key", user: { username: "alice" } }));
    expect(signedInAccountId()).toBe("alice");
  });

  it("is undefined when nobody has signed in", () => {
    expect(signedInAccountId()).toBeUndefined();
  });

  it("is undefined for a key-only store with no user block", () => {
    writeCredentials(JSON.stringify({ api_key: "hg_key" }));
    expect(signedInAccountId()).toBeUndefined();
  });

  it("is undefined for a legacy plaintext key or a malformed file", () => {
    writeCredentials("hg_legacy_plaintext_key_0123456789");
    expect(signedInAccountId()).toBeUndefined();
    resetSignedInAccountCache();
    writeCredentials("{ not json");
    expect(signedInAccountId()).toBeUndefined();
  });

  it("caches the answer until reset", () => {
    writeCredentials(JSON.stringify({ user: { email: "alice@example.com" } }));
    expect(signedInAccountId()).toBe("alice@example.com");
    writeCredentials(JSON.stringify({ user: { email: "bob@example.com" } }));
    expect(signedInAccountId()).toBe("alice@example.com");
    resetSignedInAccountCache();
    expect(signedInAccountId()).toBe("bob@example.com");
  });

  it("takes a sign-in made in this process without re-reading the file", () => {
    expect(signedInAccountId()).toBeUndefined();
    setSignedInAccountId("carol@example.com");
    expect(signedInAccountId()).toBe("carol@example.com");
  });
});
