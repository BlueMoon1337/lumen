import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
