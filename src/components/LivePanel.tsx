import { useShallow } from 'zustand/react/shallow';
import { useRef, useState, type CSSProperties } from 'react';
import { timerRemaining, useNow } from '../clock';
import { useLiveFrame } from '../liveFrame';
import { useStore, type LiveTab } from '../store';
import { ALL_LAYERS, isLayerLive, LAYERS } from '../layers';
import { formatDuration, parseDuration } from '../util';
import { AudioTab } from './AudioTab';
import { seekAudio, useAudioStatus } from './AudioPlayer';
import { OutputView } from './Canvas';
import { ClearGroupsRow } from './ClearGroups';
import { openContextMenu } from './ContextMenu';
import { useMediaStatus } from './MediaClock';
import { PLAYBACK, playbackEntries } from './menus';
import { setPaneSize, Splitter } from './Splitter';
import { StageView } from './StageView';
import { layoutFor } from '../stageLayouts';
import { TransitionButton } from './TransitionPicker';
import { Icon, IconButton, SectionHeader, type IconName } from './ui';

/** ProPresenter's clear column: one button per layer, lit while that layer has something on it. */
function ClearColumn() {
  const live = useStore((s) => s.live);
  const s = useStore.getState();
  return (
    <div className="clear-strip">
      {LAYERS.map((l) => {
        const active = isLayerLive(live, l.id);
        return (
          <button
            key={l.id}
            className={`clear-btn ${active ? 'active' : ''}`}
            onClick={() => s.clearLayers([l.id])}
            disabled={!active}
            title={`Clear ${l.label}${l.hotkey ? ` (${l.hotkey})` : ''}`}
            aria-label={`Clear ${l.label}`}
          >
            <Icon name={l.icon} size={16} />
          </button>
        );
      })}
    </div>
  );
}

const time = (seconds: number) => formatDuration(Math.round(seconds) * 1000);

/**
 * A position slider for something playing. While it's being dragged it shows where it's been
 * dragged to, not where the playback still is, so letting go doesn't snap it back.
 */
function Scrubber({ time, duration, onSeek, label }: { time: number; duration: number; onSeek: (seconds: number) => void; label: string }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const release = () => setTimeout(() => setDragging(null), 250);
  return (
    <input
      className="np-seek pink-range"
      type="range"
      min={0}
      max={duration || 1}
      step={0.1}
      value={Math.min(dragging ?? time, duration || 1)}
      onChange={(e) => {
        const to = Number(e.target.value);
        setDragging(to);
        onSeek(to);
      }}
      onPointerUp={release}
      onKeyUp={release}
      onBlur={release}
      aria-label={label}
    />
  );
}

/** What's playing: the media bin's video, and audio from the Audio tab, each with its controls. */
function NowPlaying() {
  const live = useStore((s) => s.live);
  const video = useStore((s) => s.media.find((m) => m.id === s.live.mediaId && m.kind === 'video'));
  const audio = useStore((s) => s.media.find((m) => m.id === s.live.audioId));
  const status = useAudioStatus();
  const s = useStore.getState();
  const image = useStore((s) => s.media.find((m) => m.id === s.live.mediaId && m.kind === 'image'));
  if (!video && !image && !audio && !live.videoInput) return <div className="transport-name">Nothing playing</div>;
  return (
    <div className="now-playing">
      {live.videoInput && (
        <div className="np-row">
          <Icon name="video" size={14} />
          <span className="np-name">{live.videoInput.label}</span>
        </div>
      )}
      {image && (
        <div className="np-row">
          <Icon name="image" size={14} />
          <span className="np-name">{image.name}</span>
        </div>
      )}
      {video && <VideoTransport />}
      {audio && (
        <div className="np-row">
          <Icon name="music" size={14} />
          <span className="np-name">{audio.name}</span>
          <span className="np-time">
            {time(status.time)} / {time(status.duration)}
          </span>
          <IconButton icon="reset" title="Play from the start" onClick={s.restartAudio} />
          <IconButton
            icon={live.audioPaused ? 'play' : 'pause'}
            title={live.audioPaused ? 'Play' : 'Pause'}
            onClick={() => s.setAudioPaused(!live.audioPaused)}
          />
          <Scrubber time={status.time} duration={status.duration} onSeek={seekAudio} label="Position" />
        </div>
      )}
    </div>
  );
}

/** The live video: time, position, skip, pause, play from the start, and what happens at the end. */
function VideoTransport() {
  const live = useStore((s) => s.live);
  const video = useStore((s) => s.media.find((m) => m.id === s.live.mediaId));
  const status = useMediaStatus();
  const s = useStore.getState();
  if (!video) return null;
  const playback = PLAYBACK.find((p) => p.value === (video.playback ?? 'loop'))!;
  const skip = (by: number) => s.seekMedia(Math.min(Math.max(0, status.time + by), Math.max(0, status.duration - 0.1)));
  return (
    <div className="np-row np-video">
      <Icon name="video" size={14} />
      <span className="np-name">{video.name}</span>
      <span className="np-time" title="Played / left">
        {time(status.time)} / −{time(Math.max(0, status.duration - status.time))}
      </span>
      <Scrubber time={status.time} duration={status.duration} onSeek={s.seekMedia} label="Video position" />
      <div className="np-buttons">
        <IconButton icon="reset" title="Play from the start" onClick={s.restartMedia} />
        <IconButton icon="back10" title="Back 10 seconds" onClick={() => skip(-10)} />
        <IconButton
          icon={live.mediaPaused ? 'play' : 'pause'}
          title={live.mediaPaused ? 'Play' : 'Pause'}
          onClick={() => s.setMediaPaused(!live.mediaPaused)}
        />
        <IconButton icon="forward10" title="Forward 10 seconds" onClick={() => skip(10)} />
        <button
          type="button"
          className="np-playback"
          title="What happens when the video ends"
          onClick={(e) =>
            openContextMenu(
              {
                clientX: e.currentTarget.getBoundingClientRect().left,
                clientY: e.currentTarget.getBoundingClientRect().bottom + 4,
                preventDefault() {},
                stopPropagation() {},
              },
              playbackEntries(video.id),
            )
          }
        >
          <Icon name={playback.icon} size={13} /> {playback.short}
        </button>
      </div>
    </div>
  );
}

const TABS: { id: LiveTab; icon: IconName; label: string }[] = [
  { id: 'audio', icon: 'music', label: 'Audio' },
  { id: 'stage', icon: 'person', label: 'Stage' },
  { id: 'timers', icon: 'clock', label: 'Timers' },
  { id: 'messages', icon: 'send', label: 'Messages' },
  { id: 'props', icon: 'layers', label: 'Props' },
];

/** ProPresenter's right column: preview, clear-layer buttons, transport and the utility tabs. */
export function LivePanel() {
  const frame = useLiveFrame((s) => s.frame);
  const live = useStore((s) => s.live);
  const tab = useStore((s) => s.liveTab);
  const s = useStore.getState();
  const [screen, setScreen] = useState<'audience' | 'stage'>('audience');
  const anything = ALL_LAYERS.some((l) => isLayerLive(live, l));
  // Height of the preview and transport above the tabs; unset, the preview is as tall as its width allows.
  const topHeight = useStore((s) => s.settings.panes?.liveTop);
  const side = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);

  return (
    <aside
      ref={side}
      className={`live-side ${topHeight ? 'sized' : ''}`}
      style={topHeight ? ({ '--live-top': `${topHeight}px` } as CSSProperties) : undefined}
    >
      <div ref={top} className="live-top">
        <div className="preview-row">
          <div className="preview">
            {/* The first audience screen's look, or the first stage screen's layout. */}
            {screen === 'audience' ? (
              <OutputView frame={frame} look={firstOf(frame.looks)} />
            ) : (
              <StageView frame={frame} layout={firstOf(frame.stageLayouts)} />
            )}
          </div>
          <button className="clear-all" onClick={s.clearAll} disabled={!anything} title="Clear All (F1)" aria-label="Clear all">
            <Icon name="close" size={14} />
          </button>
          <ClearColumn />
        </div>
        <div className="screen-row">
          <select value={screen} onChange={(e) => setScreen(e.target.value as 'audience' | 'stage')} aria-label="Preview screen">
            <option value="audience">Audience</option>
            <option value="stage">Stage</option>
          </select>
          <span className="screen-label">{frame.stage.currentLabel ?? ''}</span>
          <TransitionButton target="global" className="live-transition" prefix="Global" />
        </div>
        <ClearGroupsRow />
        <div className="transport">
          <NowPlaying />
        </div>
      </div>
      <Splitter
        axis="y"
        label="Preview height"
        className="pane-split-live-top"
        measure={() => top.current?.offsetHeight ?? 0}
        min={120}
        max={() => (side.current?.clientHeight ?? 600) - 140}
        apply={(size) => {
          side.current?.classList.add('sized');
          side.current?.style.setProperty('--live-top', `${size}px`);
        }}
        commit={(size) => setPaneSize('liveTop', size)}
        reset={() => setPaneSize('liveTop', undefined)}
      />
      <nav className="live-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => s.setUI({ liveTab: t.id })}
            title={t.label}
            aria-label={t.label}
          >
            <Icon name={t.icon} size={18} />
          </button>
        ))}
      </nav>
      <div className="live-tab-body">
        {tab === 'audio' && <AudioTab />}
        {tab === 'stage' && <StageTab />}
        {tab === 'timers' && <TimersTab />}
        {tab === 'messages' && <MessagesTab />}
        {tab === 'props' && <PropsTab />}
      </div>
    </aside>
  );
}

function TimersTab() {
  const timer = useStore((s) => s.timer);
  const s = useStore.getState();
  const now = useNow(250);
  const remaining = timerRemaining(timer, now);
  const [draft, setDraft] = useState(() => formatDuration(timer.durationMs));

  return (
    <>
      <SectionHeader title="Timers" />
      <div className="tab-pad">
        <div className="timer-card">
          <div className="timer-card-head">
            <span>Countdown</span>
            <select
              value={timer.mode}
              onChange={(e) => s.setTimer({ mode: e.target.value as 'duration' | 'toTime' })}
              disabled={timer.running}
              aria-label="Countdown mode"
            >
              <option value="duration">Duration</option>
              <option value="toTime">To time of day</option>
            </select>
          </div>
          <div className={`timer-value ${remaining < 0 ? 'over' : ''}`}>{formatDuration(remaining)}</div>
          <div className="timer-controls">
            {timer.mode === 'duration' ? (
              <input
                className="timer-input"
                value={draft}
                disabled={timer.running}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  const ms = parseDuration(draft);
                  if (ms != null) s.setTimer({ durationMs: ms });
                  setDraft(formatDuration(ms ?? timer.durationMs));
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                aria-label="Duration (m:ss)"
                title="Minutes, or m:ss"
              />
            ) : (
              <input
                className="timer-input"
                type="time"
                value={timer.targetTime}
                disabled={timer.running}
                onChange={(e) => s.setTimer({ targetTime: e.target.value })}
                aria-label="Count down to"
              />
            )}
            <button className={`btn small ${timer.running ? 'on' : ''}`} onClick={timer.running ? s.pauseTimer : s.startTimer}>
              <Icon name={timer.running ? 'pause' : 'play'} size={12} /> {timer.running ? 'Pause' : 'Start'}
            </button>
            <IconButton icon="reset" title="Reset" onClick={s.resetTimer} />
          </div>
        </div>
        <p className="muted small-print">Shows on the stage display. Put {'{countdown}'} in a message to show it to the audience.</p>
      </div>
    </>
  );
}

function MessagesTab() {
  const messages = useStore((s) => s.messages);
  const liveId = useStore((s) => s.live.messageId);
  const s = useStore.getState();
  const [draft, setDraft] = useState('');

  return (
    <>
      <SectionHeader title="Messages" onAdd={() => s.addMessage('New message')} addTitle="New message" />
      <ul className="messages">
        {messages.map((m) => (
          <li key={m.id} className={liveId === m.id ? 'live' : ''}>
            <input value={m.text} onChange={(e) => s.updateMessage(m.id, e.target.value)} aria-label="Message text" />
            <button className={`btn small ${liveId === m.id ? 'on' : ''}`} onClick={() => s.showMessage(liveId === m.id ? null : m.id)}>
              {liveId === m.id ? 'Hide' : 'Show'}
            </button>
            <IconButton icon="trash" title="Delete message" danger onClick={() => s.deleteMessage(m.id)} />
          </li>
        ))}
      </ul>
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) s.addMessage(draft.trim());
          setDraft('');
        }}
      >
        <input placeholder="New message… use {countdown} or {clock}" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="icon-btn" type="submit" title="Add message" aria-label="Add message">
          <Icon name="plus" />
        </button>
      </form>
    </>
  );
}

const firstOf = <T,>(byScreen: Record<string, T> | undefined): T | undefined => (byScreen ? Object.values(byScreen)[0] : undefined);

function StageTab() {
  const current = useStore((s) => s.live.stageMessage);
  const { setStageMessage } = useStore.getState();
  const [draft, setDraft] = useState('');
  return (
    <>
      <SectionHeader title="Stage" />
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) setStageMessage(draft.trim());
        }}
      >
        <input placeholder="Message to the stage only" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn small" type="submit">
          Show
        </button>
        <button className="btn small" type="button" disabled={!current} onClick={() => setStageMessage(null)}>
          Clear
        </button>
      </form>
      {current && <div className="stage-message-live">On stage: {current}</div>}
      <StageLayoutPicker />
    </>
  );
}

/** Which layout each stage screen shows (Screens ▸ Edit Layouts… makes them). */
function StageLayoutPicker() {
  const screens = useStore(useShallow((s) => s.screens.screens.filter((sc) => sc.kind === 'stage')));
  const layouts = useStore((s) => s.stageLayouts);
  const s = useStore.getState();
  return (
    <>
      <SectionHeader title="Layouts" />
      <div className="stage-layout-picks">
        {screens.map((sc) => (
          <label key={sc.id} className="field-row">
            <span>{sc.name}</span>
            <select value={layoutFor(sc, layouts).id} onChange={(e) => s.updateScreen(sc.id, { stageLayoutId: e.target.value })}>
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        {!screens.length && <p className="muted small-print">No stage screens. Add one in Configure Screens.</p>}
        <button className="btn small" onClick={() => s.setUI({ mode: 'layouts' })}>
          Edit Layouts…
        </button>
      </div>
    </>
  );
}

function PropsTab() {
  const media = useStore((s) => s.media);
  const logoId = useStore((s) => s.settings.logoMediaId);
  const logoOn = useStore((s) => s.live.logo);
  const s = useStore.getState();
  return (
    <>
      <SectionHeader title="Props" />
      <div className="tab-pad">
        <div className="prop-row">
          <span>Logo</span>
          <select
            value={logoId ?? ''}
            onChange={(e) => s.updateSettings({ logoMediaId: e.target.value || undefined })}
            aria-label="Logo image"
          >
            <option value="">None</option>
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button className={`btn small ${logoOn ? 'on' : ''}`} disabled={!logoId} onClick={s.toggleLogo}>
            {logoOn ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="muted small-print">
          The logo covers everything on the audience screen. F4 clears it; F12 clears everything else and shows it.
        </p>
      </div>
    </>
  );
}
