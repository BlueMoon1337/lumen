import { isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import type { OutputFrame } from './types';

// The control window sends OutputFrames to output windows: over the desktop app's own
// events in Lumen's desktop app, and over a BroadcastChannel in a browser.

const CHANNEL = 'lumen-output';

type ChannelMessage = { type: 'frame'; frame: OutputFrame } | { type: 'hello' };

interface Channel {
  post(message: ChannelMessage): void;
  close(): void;
}

function openChannel(onMessage: (message: ChannelMessage) => void): Channel {
  if (isTauri()) {
    let stop: (() => void) | undefined;
    let closed = false;
    const listening = listen<ChannelMessage>(CHANNEL, (e) => onMessage(e.payload)).then((unlisten) => {
      if (closed) unlisten();
      else stop = unlisten;
    });
    return {
      // Only speak once listening, so a new output window can't miss the reply to its hello.
      post: (message) => void listening.then(() => emit(CHANNEL, message)),
      close: () => {
        closed = true;
        stop?.();
      },
    };
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<ChannelMessage>) => e.data && onMessage(e.data);
  return { post: (message) => channel.postMessage(message), close: () => channel.close() };
}

/** Control window: answers new output windows and pushes every change. */
export function startBroadcasting(getFrame: () => OutputFrame) {
  const channel = openChannel((message) => {
    if (message.type === 'hello') channel.post({ type: 'frame', frame: getFrame() });
  });
  return {
    send: (frame: OutputFrame) => channel.post({ type: 'frame', frame }),
    close: () => channel.close(),
  };
}

/** Output windows: the latest frame from the control window. */
export function useRemoteFrame(): OutputFrame | null {
  const [frame, setFrame] = useState<OutputFrame | null>(null);
  useEffect(() => {
    const channel = openChannel((message) => {
      if (message.type === 'frame') setFrame(message.frame);
    });
    channel.post({ type: 'hello' });
    return () => channel.close();
  }, []);
  return frame;
}
