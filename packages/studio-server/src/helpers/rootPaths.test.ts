import { describe, expect, it } from "vitest";
import { withRootPathsUnderBase } from "./rootPaths.js";

const BASE = "/api/projects/demo/preview/";

describe("withRootPathsUnderBase", () => {
  it("moves the composition's root paths under the base, in every quoting and in CSS", () => {
    const html = withRootPathsUnderBase(
      `<audio class="clip" src="/assets/vo-1.mp3"></audio><video src='/v.mp4' poster=/p.png></video>` +
        `<svg><image xlink:href="/i.svg"/></svg><link rel="stylesheet" href="/styles/main.css">` +
        `<div style="background: url('/bg.png')"></div><style>.a { background: url(/a.png) }</style>` +
        `<template><img src="/in-template.png"></template>`,
      BASE,
    );
    expect(html).toBe(
      `<audio class="clip" src="${BASE}assets/vo-1.mp3"></audio><video src='${BASE}v.mp4' poster=${BASE}p.png></video>` +
        `<svg><image xlink:href="${BASE}i.svg"/></svg><link rel="stylesheet" href="${BASE}styles/main.css">` +
        `<div style="background: url('${BASE}bg.png')"></div><style>.a { background: url(${BASE}a.png) }</style>` +
        `<template><img src="${BASE}in-template.png"></template>`,
    );
  });

  it("leaves links, <base>, other hosts, relative and already-moved paths, script text and comments", () => {
    const html =
      `<base href="/cdn/"><a href="/about">x</a><img src="//cdn.example/x.png"><img src="https://h/x.png">` +
      `<img src="assets/x.png"><img src="${BASE}x.png"><img data-src="/lazy.png">` +
      `<script>fetch("/data.json"); const s = '<img src="/s.png">';</script><!-- <img src="/c.png"> -->`;
    expect(withRootPathsUnderBase(html, BASE)).toBe(html);
  });
});
