export interface FrameWant {
  time: number;
  displayedPixels: number;
  holdLastFrame: boolean;
}

export interface SeekPlan {
  seek?: number;
  select?: number;
  /** Where ffmpeg really starts decoding: the keyframe at or before `seek`. */
  decodesFrom?: number;
}

/** A frame with its decode known: runs from `decodesFrom`, `-ss seek` drops the rest, `seek + select` is the cut. */
export interface PlannedFrame extends FrameWant {
  seek: number;
  select: number;
  decodesFrom: number;
}

interface FrameBankDeps {
  probe: (path: string, time: number, holdLastFrame: boolean) => Promise<SeekPlan | null>;
  /** One ffmpeg pass over `frames`, which share a displayed size; throws when the pass fails. */
  decode: (path: string, frames: PlannedFrame[]) => Promise<Buffer[]>;
}

const slotKey = (path: string, want: FrameWant) =>
  `${path}\0${want.time.toFixed(6)}\0${want.displayedPixels}\0${want.holdLastFrame}`;

/** Frames whose decode runs overlap share one pass: a one-keyframe source decodes once, not once per frame. */
export function groupOverlappingDecodes(frames: PlannedFrame[]): PlannedFrame[][] {
  const sorted = [...frames].sort((a, b) => a.decodesFrom - b.decodesFrom);
  const groups: PlannedFrame[][] = [];
  let end = Number.NEGATIVE_INFINITY;
  for (const frame of sorted) {
    if (frame.decodesFrom > end) groups.push([]);
    groups[groups.length - 1]!.push(frame);
    end = Math.max(end, frame.seek + frame.select);
  }
  return groups;
}

/** Plans every frame a video will be asked for, decodes them group by group, and hands each one to its request.
 * A pass that fails hands back nothing, so its frames decode one at a time as they always did. */
export function createFrameBank(deps: FrameBankDeps) {
  const slots = new Map<string, { frame: Promise<Buffer | undefined>; uses: number }>();
  const stats = { passes: 0, frames: 0, sharedFrames: 0, longestDecodeSeconds: 0 };
  return {
    stats,
    async plan(path: string, wants: FrameWant[]): Promise<void> {
      const asked = new Map<string, number>();
      for (const want of wants)
        asked.set(slotKey(path, want), (asked.get(slotKey(path, want)) ?? 0) + 1);
      const fresh = wants.filter((want, i) => {
        const key = slotKey(path, want);
        return !slots.has(key) && wants.findIndex((other) => slotKey(path, other) === key) === i;
      });
      const planned: PlannedFrame[] = [];
      try {
        const plans = await Promise.all(
          fresh.map((want) => deps.probe(path, want.time, want.holdLastFrame)),
        );
        for (const [i, plan] of plans.entries()) {
          if (plan?.seek !== undefined && plan.select !== undefined)
            planned.push({
              ...fresh[i]!,
              seek: plan.seek,
              select: plan.select,
              decodesFrom: plan.decodesFrom ?? plan.seek,
            });
        }
      } catch {
        // A probe that fails leaves its frames to the single-frame path, which reports the reason.
        return;
      }
      const sizes = [...new Set(planned.map((frame) => frame.displayedPixels))];
      const groups = sizes.flatMap((size) =>
        groupOverlappingDecodes(planned.filter((frame) => frame.displayedPixels === size)),
      );
      for (const group of groups) {
        stats.passes += 1;
        stats.frames += group.length;
        if (group.length > 1) stats.sharedFrames += group.length;
        for (const frame of group)
          stats.longestDecodeSeconds = Math.max(
            stats.longestDecodeSeconds,
            frame.seek + frame.select - frame.decodesFrom,
          );
        const run = deps.decode(path, group).catch(() => undefined);
        for (const [i, frame] of group.entries()) {
          const slot = run.then((buffers) => buffers?.[i]);
          slots.set(slotKey(path, frame), {
            frame: slot,
            uses: asked.get(slotKey(path, frame)) ?? 1,
          });
        }
      }
    },
    /** The planned frame's bytes; undefined, now or once its pass failed, means decode it alone. */
    take(path: string, want: FrameWant): Promise<Buffer | undefined> | undefined {
      const key = slotKey(path, want);
      const slot = slots.get(key);
      if (slot && --slot.uses <= 0) slots.delete(key);
      return slot?.frame;
    },
  };
}
