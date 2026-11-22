import { useStore } from '../store';
import { Icon, SectionHeader } from './ui';

/**
 * Countdown Videos: one of the media bin's countdowns, chosen at random, on the Media layer (for
 * the audience). In the Timers tab, and the Audio tab beside Countdown Fade.
 */
export function RandomCountdown() {
  const count = useStore((s) => s.media.filter((m) => m.kind === 'video' && m.countdown).length);
  const live = useStore((s) => s.media.find((m) => m.id === s.live.mediaId && m.countdown));
  const playlists = useStore((s) => s.audioPlaylists);
  const chosen = useStore((s) => s.settings.countdownPlaylistId);
  const logoAfter = useStore((s) => s.settings.logoAfterCountdown !== false);
  const playerRemote = useStore((s) => s.settings.playerRemote !== false);
  const desktop = !!window.lumenDesktop;
  const hasLogo = useStore((s) => s.media.some((m) => m.id === s.settings.logoMediaId));
  const playlistId = playlists.some((pl) => pl.id === chosen) ? chosen : '';
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
        <label className="field-row random-countdown-music">
          <span>With music</span>
          <select
            value={playlistId}
            onChange={(e) => s.updateSettings({ countdownPlaylistId: e.target.value || undefined })}
            aria-label="Audio playlist that plays with a random countdown"
            title="The audio playlist that starts when a random countdown plays (it keeps going if it's already playing)"
          >
            <option value="">No music</option>
            {playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
                {pl.shuffle ? ' (shuffled)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row" title={hasLogo ? undefined : 'There’s no logo yet: choose one in Media ▸ Logo'}>
          <input
            type="checkbox"
            checked={logoAfter}
            onChange={(e) => s.updateSettings({ logoAfterCountdown: e.target.checked ? undefined : false })}
          />
          Show the logo when it ends
        </label>
        {desktop && (
          <label
            className="check-row"
            title="Player's Random Countdown and Outro boxes, on this computer or another one on the network, play them here"
          >
            <input
              type="checkbox"
              checked={playerRemote}
              onChange={(e) => s.updateSettings({ playerRemote: e.target.checked ? undefined : false })}
            />
            Player can play the countdown and outro
          </label>
        )}
        {!playlists.length && (
          <p className="muted small-print">Make an audio playlist in the Audio tab to play music with the countdown.</p>
        )}
      </div>
    </>
  );
}
