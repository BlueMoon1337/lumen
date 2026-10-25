import { useState } from 'react';
import { timerRemaining, useNow } from '../frame';
import { useLiveFrame } from '../liveFrame';
import { useStore } from '../store';
import { formatDuration, parseDuration } from '../util';
import { OutputView } from './Canvas';
import { StageView } from './StageApp';
import { Icon, IconButton } from './ui';

export function LivePanel() {
  const frame = useLiveFrame((s) => s.frame);
  const live = useStore((s) => s.live);
  const hasLogo = useStore((s) => !!s.settings.logoMediaId);
  const s = useStore.getState();
  const [monitor, setMonitor] = useState<'audience' | 'stage'>('audience');

  return (
    <div className="live-panel">
      <section className="panel">
        <header className="panel-header">
          <h3>
            <span className={`on-air ${frame.slide || frame.background || frame.message || frame.logoMediaId ? 'active' : ''}`} />
            Live
          </h3>
          <div className="segmented small">
            <button className={monitor === 'audience' ? 'active' : ''} onClick={() => setMonitor('audience')}>
              Audience
            </button>
            <button className={monitor === 'stage' ? 'active' : ''} onClick={() => setMonitor('stage')}>
              Stage
            </button>
          </div>
        </header>
        <div className="monitor">{monitor === 'audience' ? <OutputView frame={frame} /> : <StageView frame={frame} />}</div>
        <div className="monitor-caption muted">{frame.stage.currentLabel ?? 'Nothing on screen'}</div>
        <div className="clear-grid">
          <button className="btn clear-all" onClick={s.clearAll} title="F1">
            Clear All <kbd>F1</kbd>
          </button>
          <button className="btn" onClick={s.clearSlide} disabled={!live.slide} title="F2">
            Slide <kbd>F2</kbd>
          </button>
          <button className="btn" onClick={s.clearMedia} disabled={!live.mediaId} title="F3">
            Media <kbd>F3</kbd>
          </button>
          <button className="btn" onClick={() => s.showMessage(null)} disabled={!live.messageId} title="F4">
            Message <kbd>F4</kbd>
          </button>
          <button
            className={`btn ${live.logo ? 'on' : ''}`}
            onClick={s.toggleLogo}
            disabled={!hasLogo}
            title={hasLogo ? 'F6' : 'Choose a logo in the Media bin first'}
          >
            Logo <kbd>F6</kbd>
          </button>
        </div>
      </section>
      <TimerSection />
      <MessagesSection />
      <StageMessageSection />
    </div>
  );
}

function TimerSection() {
  const timer = useStore((s) => s.timer);
  const s = useStore.getState();
  const now = useNow(250);
  const remaining = timerRemaining(timer, now);
  const [draft, setDraft] = useState(() => formatDuration(timer.durationMs));

  return (
    <section className="panel">
      <header className="panel-header">
        <h3>Countdown</h3>
        <select
          value={timer.mode}
          onChange={(e) => s.setTimer({ mode: e.target.value as 'duration' | 'toTime' })}
          disabled={timer.running}
          aria-label="Countdown mode"
        >
          <option value="duration">Duration</option>
          <option value="toTime">To time of day</option>
        </select>
      </header>
      <div className="timer">
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
          {timer.running ? (
            <IconButton icon="pause" title="Pause" onClick={s.pauseTimer} />
          ) : (
            <IconButton icon="play" title="Start" onClick={s.startTimer} />
          )}
          <IconButton icon="reset" title="Reset" onClick={s.resetTimer} />
        </div>
      </div>
    </section>
  );
}

function MessagesSection() {
  const messages = useStore((s) => s.messages);
  const liveId = useStore((s) => s.live.messageId);
  const s = useStore.getState();
  const [draft, setDraft] = useState('');

  return (
    <section className="panel">
      <header className="panel-header">
        <h3>Messages</h3>
      </header>
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
    </section>
  );
}

function StageMessageSection() {
  const current = useStore((s) => s.live.stageMessage);
  const { setStageMessage } = useStore.getState();
  const [draft, setDraft] = useState('');
  return (
    <section className="panel">
      <header className="panel-header">
        <h3>Stage message</h3>
      </header>
      <form
        className="add-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) setStageMessage(draft.trim());
        }}
      >
        <input placeholder="Visible to the stage only" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn small" type="submit">
          Show
        </button>
        <button className="btn small" type="button" disabled={!current} onClick={() => setStageMessage(null)}>
          Clear
        </button>
      </form>
      {current && <div className="stage-message-live">On stage: {current}</div>}
    </section>
  );
}
