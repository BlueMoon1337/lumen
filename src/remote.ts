import { fadeOutMusic } from './components/AudioPlayer';
import { useStore, type AppState } from './store';

/**
 * Lumen Remote: Player (github.com/BlueMoon1337/Player), on this computer or another one on the
 * local network, can play a random countdown or the outro, from boxes at either end of its song
 * list, and fade out the music on the Audio layer. The desktop app answers Player (src-tauri/src/remote.rs); this side tells it what there is
 * to play, and plays it when asked, as the buttons here do. Settings ▸ Player ▸ "Player can play the
 * countdown and outro, and fade the music" turns it off.
 */

/** What Player can ask for. */
export type RemoteCommand = 'random-countdown' | 'outro' | 'fade-music';
const COMMANDS: RemoteCommand[] = ['random-countdown', 'outro', 'fade-music'];

/** What Player is told it can play. */
export interface RemoteStatus {
  allowed: boolean;
  /** How many countdown videos there are. */
  countdowns: number;
  /** The active outro's name, if there is one. */
  outro: string | null;
  /** The track on the Audio layer, if any. */
  music: string | null;
  /**
   * Each command Player can send: null when it can be done now, else why not. The desktop app
   * answers by this, so a new command needs only the interface (an interface update).
   */
  can: Record<RemoteCommand, string | null>;
}

export function remoteStatus(s: Pick<AppState, 'media' | 'settings' | 'live'>): RemoteStatus {
  const outro = s.media.find((m) => m.id === s.settings.outroMediaId);
  const music = s.live.audioId ? (s.media.find((m) => m.id === s.live.audioId)?.name ?? 'Music') : null;
  const countdowns = s.media.filter((m) => m.kind === 'video' && m.countdown).length;
  return {
    allowed: s.settings.playerRemote !== false,
    countdowns,
    outro: outro ? outro.name : null,
    music,
    can: {
      'random-countdown': countdowns ? null : 'Lumen has no countdown videos (Media ▸ Countdowns).',
      outro: outro ? null : 'Lumen has no outro (Media ▸ Outro).',
      'fade-music': music ? null : 'No music is playing in Lumen.',
    },
  };
}

/** What Player asked for: a command, and for a fade, how long it takes. */
export interface RemoteRequest {
  what: string;
  seconds?: number | null;
}

/** Does what Player asked for, if it's allowed. */
export function playForRemote({ what, seconds }: RemoteRequest) {
  const s = useStore.getState();
  if (s.settings.playerRemote === false || !COMMANDS.includes(what as RemoteCommand)) return;
  if (what === 'random-countdown') s.playRandomCountdown();
  else if (what === 'outro') s.playOutro();
  else if (what === 'fade-music') fadeOutMusic(seconds ?? 4);
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
