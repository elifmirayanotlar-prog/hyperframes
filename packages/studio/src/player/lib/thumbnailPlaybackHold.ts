import type { ThumbnailScheduler } from "./thumbnailScheduler";

interface PlaybackStore {
  getState(): { isPlaying: boolean };
  subscribe(listener: (state: { isPlaying: boolean }) => void): () => void;
}

/**
 * Feeds the store's playing state to the scheduler, so a playing preview does not share the
 * decoder with timeline thumbnails. Subscribed to the state, not to setIsPlaying, so a reset
 * that writes isPlaying: false directly also lets the held work go.
 */
export function bindThumbnailPlaybackHold(
  store: PlaybackStore,
  scheduler: Pick<ThumbnailScheduler, "setPlaybackActive">,
): () => void {
  scheduler.setPlaybackActive(store.getState().isPlaying);
  return store.subscribe((state) => scheduler.setPlaybackActive(state.isPlaying));
}
