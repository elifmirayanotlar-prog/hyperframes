import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

describe("caption rules", () => {
  it("warns when caption exit has no hard kill tl.set", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <div id="caption-container"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      GROUPS.forEach(function(group, gi) {
        var groupEl = document.createElement("div");
        groupEl.id = "cg-" + gi;
        tl.set(groupEl, { opacity: 1 }, group.start);
        tl.to(groupEl, { opacity: 0, duration: 0.12 }, group.end - 0.12);
      });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not warn when caption exit has hard kill tl.set", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <div id="caption-container"></div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      GROUPS.forEach(function(group, gi) {
        var groupEl = document.createElement("div");
        groupEl.id = "cg-" + gi;
        tl.set(groupEl, { opacity: 1 }, group.start);
        tl.to(groupEl, { opacity: 0, duration: 0.12 }, group.end - 0.12);
        tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);
      });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("does not warn for generic GSAP opacity exits in non-caption loops", async () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var sceneCaption = document.querySelector("#scene-caption");
      CARDS.forEach(function(group, gi) {
        var groupEl = document.createElement("div");
        groupEl.id = "card-" + gi;
        tl.to(groupEl, { opacity: 0, duration: 0.12 }, 2);
      });
      window.__timelines["main"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("does not warn on a content frame that only mentions karaoke in a comment", async () => {
    const html = `<template id="06-one-platform-template">
  <div id="root" data-composition-id="06-one-platform" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      // "Minutes, not weeks" lands with a karaoke-style keyword glow
      SCREENS.forEach(function (s, i) {
        var el = document.getElementById("screen-" + i);
        tl.to(el, { y: -40, opacity: 0, duration: 0.3 }, i * 1.3);
      });
      window.__timelines["06-one-platform"] = tl;
    </script>
  </div>
</template>`;
    const result = await lintHyperframeHtml(html, { isSubComposition: true });
    const finding = result.findings.find((f) => f.code === "caption_exit_missing_hard_kill");
    expect(finding).toBeUndefined();
  });

  it("warns when caption group has nowrap without max-width", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group {
        position: absolute;
        white-space: nowrap;
        text-align: center;
      }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_text_overflow_risk");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does not warn when caption group has nowrap with max-width", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group {
        position: absolute;
        white-space: nowrap;
        max-width: 1600px;
        overflow: hidden;
      }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find(
      (f) => f.code === "caption_text_overflow_risk" && f.severity === "warning",
    );
    expect(finding).toBeUndefined();
  });

  it("warns when caption container uses position: relative", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group {
        position: relative;
      }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_container_relative_position");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("errors when the caption transcript is fetched instead of inlined", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group { position: absolute; }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      fetch("transcript.json").then(function (res) { return res.json(); });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_transcript_not_inline");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not error when the caption transcript is inlined", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group { position: absolute; }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var TRANSCRIPT = [{ "text": "Hello", "start": 0, "end": 1 }];
      fetch("transcript.json").then(function (res) { return res.json(); });
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_transcript_not_inline");
    expect(finding).toBeUndefined();
  });

  it("warns when textShadow is tweened on a caption group container", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group { position: absolute; }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var groupEl = document.querySelector(".caption-group");
      tl.to(groupEl, { textShadow: "0 0 20px #fff", duration: 0.2 }, 0);
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_textshadow_on_group_container");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does not warn when textShadow is tweened on an individual word", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>
      .caption-group { position: absolute; }
    </style>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var wordEl = document.querySelector(".caption-word");
      tl.to(wordEl, { textShadow: "0 0 20px #fff", duration: 0.2 }, 0);
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_textshadow_on_group_container");
    expect(finding).toBeUndefined();
  });

  it("warns when fitTextFontSize maxWidth times word scale overflows the frame", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var size = fitTextFontSize(text, { maxWidth: 1600 });
      tl.to(".caption-word", { scale: 1.2, duration: 0.1 }, 0);
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_fittext_scale_mismatch");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("does not warn when fitTextFontSize leaves headroom for word scale", async () => {
    const html = `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      var size = fitTextFontSize(text, { maxWidth: 1400 });
      tl.to(".caption-word", { scale: 1.2, duration: 0.1 }, 0);
      window.__timelines["captions"] = tl;
    </script>
  </div>
</body></html>`;
    const result = await lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "caption_fittext_scale_mismatch");
    expect(finding).toBeUndefined();
  });

  describe("caption_text_overflow_risk — its fix must not create an error", () => {
    const cap = (css: string) => `
<html><body>
  <div data-composition-id="captions" data-width="1920" data-height="1080">
    <style>.caption-group{${css}}</style><div class="caption-group"></div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    words.forEach((w) => tl.to(w, { scale: 1.3 }));
    window.__timelines = { captions: tl };
  </script>
</body></html>`;

    it("clears when the fixHint is applied as written", async () => {
      // The hint used to say "and overflow: hidden", which is exactly what
      // caption_overflow_clips_scaled_words errors on. Following the warning
      // produced an error.
      const before = await lintHyperframeHtml(cap("position:absolute;white-space:nowrap"));
      expect(before.findings.find((f) => f.code === "caption_text_overflow_risk")).toBeDefined();

      const after = await lintHyperframeHtml(
        cap("position:absolute;white-space:nowrap;max-width:1600px;overflow:visible"),
      );
      const blocking = after.findings.filter((f) => f.severity !== "info");
      expect(blocking.map((f) => f.code)).not.toContain("caption_text_overflow_risk");
      expect(blocking.map((f) => f.code)).not.toContain("caption_overflow_clips_scaled_words");
    });
  });
});
