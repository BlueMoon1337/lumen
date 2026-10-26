import { useEffect, useState } from 'react';
import type { OutputFrame } from './types';

// The control window sends OutputFrames to output windows over a BroadcastChannel.

const CHANNEL = 'lumen-output';

type ChannelMessage = { type: 'frame'; frame: OutputFrame } | { type: 'hello' };

/** Control window: answers new output windows and pushes every change. */
export function startBroadcasting(getFrame: () => OutputFrame) {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
    if (e.data?.type === 'hello') channel.postMessage({ type: 'frame', frame: getFrame() } satisfies ChannelMessage);
  };
  return {
    send: (frame: OutputFrame) => channel.postMessage({ type: 'frame', frame } satisfies ChannelMessage),
    close: () => channel.close(),
  };
}

/** Output windows: the latest frame from the control window. */
export function useRemoteFrame(): OutputFrame | null {
  const [frame, setFrame] = useState<OutputFrame | null>(null);
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
      if (e.data?.type === 'frame') setFrame(e.data.frame);
    };
    channel.postMessage({ type: 'hello' } satisfies ChannelMessage);
    return () => channel.close();
  }, []);
  return frame;
}
