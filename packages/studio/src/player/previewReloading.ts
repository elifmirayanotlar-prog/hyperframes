import { thumbnailScheduler } from "./lib/thumbnailScheduler";

let reloading = false;
let reloadRequested = false;
let scriptWrites = 0;
// A press gave up on the change in progress (a save that never returns); later ones do not wait on it again.
let givenUp = false;

const changing = () => reloading || reloadRequested || scriptWrites > 0;
const noteIdle = () => {
  if (!changing()) givenUp = false;
};
// The page mirrors isPreviewChanging(), so a tool that watches the preview from outside waits on the same owner.
const publish = () => {
  noteIdle();
  if (typeof document !== "undefined")
    document.documentElement.toggleAttribute("data-preview-changing", isPreviewChanging());
};

export function giveUpOnPreviewChange(): void {
  givenUp = changing();
  publish();
}

export function setPreviewReloading(next: boolean): void {
  reloading = next;
  thumbnailScheduler.setPreviewReloading(next);
  publish();
}

/** Studio asked for a reload that has not begun yet; `previewReloadBegun` closes that gap. */
export function requestPreviewReload(): void {
  reloadRequested = true;
  publish();
}

export function previewReloadBegun(): void {
  reloadRequested = false;
  publish();
}

/** A script write, scene swap or history step counts from its send until its preview update is applied, or it fails. */
export async function whileScriptWrites<T>(write: () => Promise<T>): Promise<T> {
  scriptWrites += 1;
  publish();
  try {
    return await write();
  } finally {
    scriptWrites -= 1;
    publish();
  }
}

/** The one owner of "the preview is about to change": a canvas press waits for it. */
export function isPreviewChanging(): boolean {
  return changing() && !givenUp;
}
