import { create } from 'zustand';
import { buildFrame } from './frame';
import { startBroadcasting } from './sync';
import { useStore } from './store';
import type { OutputFrame } from './types';

/** The current output frame, for the operator's own monitors. */
export const useLiveFrame = create<{ frame: OutputFrame }>(() => ({ frame: buildFrame(useStore.getState()) }));

/** Keeps the local frame and every output window in step with the store. Returns a cleanup. */
export function startFrameSync(): () => void {
  const broadcaster = startBroadcasting(() => useLiveFrame.getState().frame);
  let last = '';
  const update = () => {
    const frame = buildFrame(useStore.getState());
    const json = JSON.stringify(frame);
    if (json === last) return;
    last = json;
    useLiveFrame.setState({ frame });
    broadcaster.send(frame);
  };
  update();
  const unsubscribe = useStore.subscribe(update);
  return () => {
    unsubscribe();
    broadcaster.close();
  };
}
