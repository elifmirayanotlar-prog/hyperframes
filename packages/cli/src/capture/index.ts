import { createCaptureWatchdog, runWithWatchdog } from "./captureWatchdog.js";
import type { CaptureAttempt } from "./captureWatchdog.js";
import { createPartialCaptureState, writePartialCaptureBundle } from "./partialCapture.js";
import type { PartialCaptureState } from "./partialCapture.js";
import { captureWebsiteAttempt } from "./captureAttempt.js";
import { resolveLocalCaptureTarget, startLocalPageServer } from "./localPage.js";
import { NavigationDeadlineError } from "./captureErrors.js";
import { CAPTURE_PHASE_SCHEMA } from "./types.js";
import type { CaptureOptions, CaptureResult } from "./types.js";

export type { CaptureOptions, CaptureResult } from "./types.js";

export async function captureWebsite(
  opts: CaptureOptions,
  onProgress?: (stage: string, detail?: string) => void,
): Promise<CaptureResult> {
  if (opts.localFile === undefined) {
    if (opts.localRoot !== undefined) throw new Error("localRoot requires localFile");
    return captureTarget(opts, onProgress);
  }
  const local = resolveLocalCaptureTarget(opts.localFile, opts.localRoot);
  const server = await startLocalPageServer(local);
  try {
    const result = await captureTarget({ ...opts, url: server.url }, onProgress, server.origin);
    return { ...result, url: local.fileUrl };
  } finally {
    await server.close();
  }
}

async function captureTarget(
  opts: CaptureOptions,
  onProgress: ((stage: string, detail?: string) => void) | undefined,
  localOrigin?: string,
): Promise<CaptureResult> {
  const watchdog = createCaptureWatchdog(opts.captureDeadlineMs);
  const state = createPartialCaptureState(opts);
  const attempt = captureWebsiteAttempt(opts, onProgress, false, watchdog, state, localOrigin);
  try {
    return settle(await runWithWatchdog(attempt, watchdog.promise), opts, state);
  } catch (err) {
    if (!(err instanceof NavigationDeadlineError) || watchdog.expired() || !err.webglObserved) {
      throw err;
    }
    onProgress?.("warn", "Navigation timed out; retrying once with WebGL disabled");
    state.warnings.push("Navigation timed out; retrying once with WebGL disabled");
    opts.onPhase?.({
      schema: CAPTURE_PHASE_SCHEMA,
      phase: "navigation",
      status: "degraded",
      remainingMs: null,
      reason: "webgl-disabled-retry",
    });
    const retry = captureWebsiteAttempt(opts, onProgress, true, watchdog, state, localOrigin);
    const second = await runWithWatchdog(retry, watchdog.promise);
    if (second.kind !== "complete") return settle(second, opts, state);
    return {
      ...second.result,
      warnings: [...new Set([...state.warnings, ...second.result.warnings])],
    };
  } finally {
    watchdog.dispose();
  }
}

function settle(
  outcome: CaptureAttempt<CaptureResult>,
  opts: CaptureOptions,
  state: PartialCaptureState,
): CaptureResult {
  if (outcome.kind === "deadline") return deadlineResult(opts, state);
  if (outcome.kind === "error") throw outcome.error;
  return outcome.result;
}

function deadlineResult(opts: CaptureOptions, state: PartialCaptureState): CaptureResult {
  const lastPhase = {
    schema: CAPTURE_PHASE_SCHEMA,
    phase: "complete" as const,
    status: "degraded" as const,
    remainingMs: null,
    reason: "deadline" as const,
  };
  opts.onPhase?.(lastPhase);
  return writePartialCaptureBundle(opts, state, lastPhase);
}

// visual-style.md and capture-summary.md generators removed — DESIGN.md replaces them
