import { describe, expect, it, vi } from "vitest";
import { remoteVideoInput } from "./snapshot.js";

describe("remoteVideoInput", () => {
  const url = "https://cdn.example.com/clip.mp4";

  it("hands FFmpeg a local copy of a remote clip", async () => {
    const download = vi.fn(async () => "/cache/clip.mp4");

    await expect(remoteVideoInput(url, download)).resolves.toBe("/cache/clip.mp4");
    expect(download).toHaveBeenCalledWith(url, expect.any(String));
  });

  it("keeps the URL when the clip cannot be downloaded", async () => {
    const download = vi.fn(async () => Promise.reject(new Error("not a public https URL")));

    await expect(remoteVideoInput(url, download)).resolves.toBe(url);
  });
});
