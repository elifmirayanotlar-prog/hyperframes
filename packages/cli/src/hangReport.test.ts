import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watchForHang } from "./hangReport.js";

const dir = join(tmpdir(), "hf-hang");
const output = () => ({ write: vi.fn(() => true) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchForHang", () => {
  it("writes one report after 60 s with no output", () => {
    const writeReport = vi.fn();
    watchForHang([output()], { HYPERFRAMES_HANG_REPORT: dir }, writeReport);
    vi.advanceTimersByTime(59_000);
    expect(writeReport).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300_000);
    expect(writeReport).toHaveBeenCalledOnce();
    expect(writeReport).toHaveBeenCalledWith(join(dir, `hang-${process.pid}.json`));
  });

  it("counts every write as activity and still passes it through", () => {
    const writeReport = vi.fn();
    const out = output();
    const original = out.write;
    watchForHang([out], { HYPERFRAMES_HANG_REPORT: dir }, writeReport);
    vi.advanceTimersByTime(50_000);
    out.write("progress" as never);
    expect(original).toHaveBeenCalledWith("progress");
    vi.advanceTimersByTime(50_000);
    expect(writeReport).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(writeReport).toHaveBeenCalledOnce();
  });

  it("does nothing unless the variable names an absolute directory", () => {
    const writeReport = vi.fn();
    watchForHang([output()], {}, writeReport);
    watchForHang([output()], { HYPERFRAMES_HANG_REPORT: "relative" }, writeReport);
    vi.advanceTimersByTime(300_000);
    expect(writeReport).not.toHaveBeenCalled();
  });
});
