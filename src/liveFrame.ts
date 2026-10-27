import { create } from 'zustand';
import { useVideoClock } from './components/MediaClock';
import { buildFrame } from './frame';
import { startBroadcasting } from './sync';
import { useStore } from './store';
import type { OutputFrame } from './types';

/** The current output frame, for the operator's own monitors. */
export const useLiveFrame = create<{ frame: OutputFrame }>(() => ({ frame: buildFrame(useStore.getState()) }));

const currentFrame = (): OutputFrame => ({ ...buildFrame(useStore.getState()), videoClock: useVideoClock.getState() });

/** Keeps the local frame and every output window in step with the store. Returns a cleanup. */
export function startFrameSync(): () => void {
  const broadcaster = startBroadcasting(() => useLiveFrame.getState().frame);
  let last = '';
  const update = () => {
    const frame = currentFrame();
    const json = JSON.stringify(frame);
    if (json === last) return;
    last = json;
    useLiveFrame.setState({ frame });
    broadcaster.send(frame);
  };
  update();
  const unsubscribe = useStore.subscribe(update);
  const unsubscribeClock = useVideoClock.subscribe(update);
  return () => {
    unsubscribe();
    unsubscribeClock();
    broadcaster.close();
  };
}
