import { useStore } from '../store';
import { Icon, SectionHeader } from './ui';

/**
 * Countdown Videos: one of the media bin's countdowns, chosen at random, on the Media layer (for
 * the audience). In the Timers tab, and the Audio tab beside Countdown Fade.
 */
export function RandomCountdown() {
  const count = useStore((s) => s.media.filter((m) => m.kind === 'video' && m.countdown).length);
  const live = useStore((s) => s.media.find((m) => m.id === s.live.mediaId && m.countdown));
  const s = useStore.getState();
  return (
    <>
      <SectionHeader title="Countdown Videos" />
      <div className="tab-pad random-countdown">
        <button type="button" className="btn" disabled={!count} onClick={s.playRandomCountdown}>
          <Icon name="shuffle" size={13} /> {live ? 'Play Another Random Countdown' : 'Play a Random Countdown'}
        </button>
        <p className="muted small-print">
          {count
            ? `Puts ${count === 1 ? 'the countdown video' : `one of the ${count} countdown videos`} in Media ▸ Countdowns on the audience screen.${live ? ` Now: ${live.name}.` : ''}`
            : 'No countdown videos yet: add them in Media ▸ Countdowns.'}
        </p>
      </div>
    </>
  );
}
