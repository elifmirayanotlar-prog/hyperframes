export const MEDIA_ELEMENT_LEAD_SECONDS = 1e-5;

export function mediaElementTime(sourceSeconds: number): number {
  return sourceSeconds + MEDIA_ELEMENT_LEAD_SECONDS;
}

/** iPhone and iPad (an iPad can report as a Mac): the only browsers that refuse an unmuted start a few seconds after the tap. */
export function startsSoundOnlyInsideATap(): boolean {
  const { userAgent, maxTouchPoints } = navigator;
  return /iP(hone|ad|od)/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
