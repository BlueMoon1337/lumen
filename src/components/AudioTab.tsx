import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { countdownFade } from '../countdowns';
import { notify } from '../notices';
import { useStore } from '../store';
import type { MediaItem } from '../types';
import { NamePopup, openContextMenu, openPopupAtMenu } from './ContextMenu';
import { deleteMedia } from './deleting';
import { Icon, IconButton, pickFiles, SectionHeader } from './ui';

const importAudio = async (files?: File[]) => {
  const chosen = files ?? (await pickFiles('audio/*'));
  const audio = chosen.filter((f) => f.type.startsWith('audio/'));
  if (chosen.length && !audio.length) return notify('Those files aren’t audio.', 'error');
  await useStore.getState().addMediaFiles(audio);
};

function audioMenu(m: MediaItem, playing: boolean) {
  const s = useStore.getState();
  return [
    { label: playing ? 'Stop' : 'Play', action: () => (playing ? s.clearLayers(['audio']) : s.playAudio(m.id)) },
    { label: 'Loop', checked: !!m.loop, action: () => s.updateMedia(m.id, { loop: !m.loop }) },
    '-' as const,
    {
      label: 'Rename…',
      action: () =>
        openPopupAtMenu(
          <NamePopup
            title="Rename"
            colors={false}
            initial={{ name: m.name, color: '' }}
            onSave={(v) => s.updateMedia(m.id, { name: v.name })}
          />,
        ),
    },
    { label: 'Delete…', danger: true, action: () => deleteMedia(m.id) },
  ];
}

/**
 * Countdown Fade: music on the Audio layer fades out as a countdown ends, starting this many
 * seconds before. A countdown video, the Timers tab's countdown, or both can set it off.
 */
export function CountdownFade() {
  const fade = useStore(useShallow((s) => countdownFade(s.settings)));
  const s = useStore.getState();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    if (Number.isFinite(v)) s.updateSettings({ countdownFadeSeconds: Math.max(0, Math.min(600, Math.round(v))) });
    setDraft(null);
  };
  return (
    <>
      <SectionHeader title="Countdown Fade" />
      <div className="countdown-fade">
        <label className="countdown-fade-when">
          <span>Start fading</span>
          <input
            type="number"
            min={0}
            max={600}
            value={draft ?? String(fade.seconds)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            aria-label="Seconds before the end that the music starts to fade"
          />
          <span>seconds before the end</span>
        </label>
        <div className="countdown-fade-with">
          <label className="check-row inline">
            <input type="checkbox" checked={fade.videos} onChange={(e) => s.updateSettings({ countdownFadeVideos: e.target.checked })} />
            Countdown videos
          </label>
          <label className="check-row inline">
            <input type="checkbox" checked={fade.timer} onChange={(e) => s.updateSettings({ countdownFadeTimer: e.target.checked })} />
            Timer
          </label>
        </div>
        {fade.seconds === 0 && <p className="muted small-print">0 seconds: the music stops at the end without fading.</p>}
      </div>
    </>
  );
}

/**
 * ProPresenter's audio bin: music and sound effects that play on the Audio layer, from this
 * computer's speakers or sound card. Click one to play it, again to stop.
 */
export function AudioTab() {
  const audio = useStore(useShallow((s) => s.media.filter((m) => m.kind === 'audio')));
  const playingId = useStore((s) => s.live.audioId);
  const s = useStore.getState();
  const [dropping, setDropping] = useState(false);
  return (
    <div
      className={`audio-tab ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        void importAudio(Array.from(e.dataTransfer.files));
      }}
    >
      <CountdownFade />
      <SectionHeader title="Audio" onAdd={() => void importAudio()} addTitle="Import audio" />
      <ul className="audio-list">
        {audio.map((m) => {
          const playing = playingId === m.id;
          return (
            <li
              key={m.id}
              className={`audio-row ${playing ? 'live' : ''}`}
              onClick={() => (playing ? s.clearLayers(['audio']) : s.playAudio(m.id))}
              onContextMenu={(e) => openContextMenu(e, audioMenu(m, playing))}
              title={playing ? 'Click to stop' : 'Click to play'}
            >
              <Icon name={playing ? 'stop' : 'play'} size={13} />
              <span className="list-label">{m.name}</span>
              <span className="row-actions">
                <IconButton
                  icon="repeat"
                  title={m.loop ? 'Looping: click to play once' : 'Play once: click to loop'}
                  active={!!m.loop}
                  onClick={() => s.updateMedia(m.id, { loop: !m.loop })}
                />
              </span>
            </li>
          );
        })}
        {audio.length === 0 && <li className="empty">Drop music or sound files here, or press + to add them.</li>}
      </ul>
    </div>
  );
}
