import gsap from "gsap";
import { describe, expect, it } from "vitest";
import { seekGsapTimeline } from "./gsap";
import type { RuntimeTimelineLike } from "../types";

const FPS = 60;
const FRAMES = 150;

// A zoom punch still running when a cut sets the zoom and a slower move starts from wherever the zoom is.
function overlappingZoom() {
  const params = { z: 1 };
  const timeline = gsap.timeline({ paused: true });
  timeline.to(params, { z: 1.45, duration: 0.3, ease: "power4.out" }, 0.573);
  timeline.set(params, { z: 1.04 }, 0.8);
  timeline.to(params, { z: 1.12, duration: 1.39, ease: "power1.in" }, 0.869);
  return { params, timeline: timeline as unknown as RuntimeTimelineLike };
}

/** The zoom at each frame a renderer captures, in the order it captures them; a scene's clock starts at `hostStart`. */
function capture(frames: number[], hostStart = 0): Map<number, number> {
  const { params, timeline } = overlappingZoom();
  const zoom = new Map<number, number>();
  for (const frame of frames) {
    seekGsapTimeline(timeline, frame / FPS - hostStart, true, undefined, FPS);
    zoom.set(frame, params.z);
  }
  return zoom;
}

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);

describe("a render that captures frames out of order", () => {
  const inOrder = capture(range(0, FRAMES));

  it("gives every frame the same value when 8 workers each capture every 8th frame", () => {
    for (let worker = 0; worker < 8; worker++) {
      for (const [frame, z] of capture(range(worker, FRAMES, 8))) {
        expect([frame, z]).toEqual([frame, inOrder.get(frame)]);
      }
    }
  });

  it("gives every frame the same value when a chunk starts inside the overlap", () => {
    for (const [frame, z] of capture(range(53, FRAMES))) {
      expect([frame, z]).toEqual([frame, inOrder.get(frame)]);
    }
  });

  it("gives every frame the same value in a scene whose host starts between two frames", () => {
    const hostStart = 0.0125;
    const sceneInOrder = capture(range(1, FRAMES), hostStart);
    for (let worker = 0; worker < 8; worker++) {
      for (const [frame, z] of capture(range(worker + 1, FRAMES, 8), hostStart)) {
        expect(z).toBeCloseTo(sceneInOrder.get(frame)!, 9);
      }
    }
  });
});
