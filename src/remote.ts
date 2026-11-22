import { useStore, type AppState } from './store';

/**
 * Lumen Remote: Player (github.com/BlueMoon1337/Player), on this computer or another one on the
 * local network, can play a random countdown or the outro, from boxes at either end of its song
 * list. The desktop app answers Player (src-tauri/src/remote.rs); this side tells it what there is
 * to play, and plays it when asked, as the buttons here do. Settings: Timers ▸ Countdown Videos ▸
 * "Player can play the countdown and outro".
 */

/** What Player is told it can play. */
export interface RemoteStatus {
  allowed: boolean;
  /** How many countdown videos there are. */
  countdowns: number;
  /** The active outro's name, if there is one. */
  outro: string | null;
}

export function remoteStatus(s: Pick<AppState, 'media' | 'settings'>): RemoteStatus {
  const outro = s.media.find((m) => m.id === s.settings.outroMediaId);
  return {
    allowed: s.settings.playerRemote !== false,
    countdowns: s.media.filter((m) => m.kind === 'video' && m.countdown).length,
    outro: outro ? outro.name : null,
  };
}

/** Plays what Player asked for, if it's allowed. */
export function playForRemote(what: string) {
  const s = useStore.getState();
  if (s.settings.playerRemote === false) return;
  if (what === 'random-countdown') s.playRandomCountdown();
  else if (what === 'outro') s.playOutro();
}

/** In the desktop app's operator window: keeps the desktop app told, and plays what Player asks for. */
export function startPlayerRemote(): () => void {
  const bridge = window.lumenDesktop;
  if (!bridge?.setRemoteStatus) return () => {};
  let sent = '';
  const send = () => {
    const status = remoteStatus(useStore.getState());
    const json = JSON.stringify(status);
    if (json === sent) return;
    sent = json;
    bridge.setRemoteStatus(status);
  };
  send();
  const stopStore = useStore.subscribe(send);
  const stopPlay = bridge.onRemotePlay(playForRemote);
  return () => {
    stopStore();
    stopPlay();
  };
}
