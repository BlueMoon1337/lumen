import { useState } from 'react';
import { checkForUpdates, installUpdate, progressText, saveToken, useUpdates } from '../updates';
import { useStore } from '../store';
import { confirmDialog } from './Ask';
import { Dialog } from './ui';

const REPOSITORY = 'BlueMoon1337/lumen';
const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

/** Pasting the read-only GitHub token Lumen downloads updates with. */
function TokenForm({ onDone, replacing }: { onDone?: () => void; replacing: boolean }) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="update-token"
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        void saveToken(token)
          .then(() => onDone?.())
          .catch((err) => setError(String(err)))
          .finally(() => setSaving(false));
      }}
    >
      {!replacing && (
        <p>
          New versions of Lumen come from <b>{REPOSITORY}</b> on GitHub. The repository is private, so Lumen needs a read-only token to
          download them. Make one once:
        </p>
      )}
      <ol className="update-steps">
        <li>
          Open <span className="update-link">{TOKEN_PAGE}</span>{' '}
          <button type="button" className="btn small" onClick={() => void window.lumenDesktop?.writeClipboardText(TOKEN_PAGE)}>
            Copy Link
          </button>{' '}
          in your browser, signed in to GitHub.
        </li>
        <li>
          Name it “Lumen updates”, set <b>Expiration</b> to the longest there is, and under <b>Repository access</b> choose{' '}
          <b>Only select repositories</b> ▸ <b>lumen</b>.
        </li>
        <li>
          Under <b>Permissions ▸ Repository permissions</b>, set <b>Contents</b> to <b>Read-only</b>. Nothing else.
        </li>
        <li>
          <b>Generate token</b>, copy it, and paste it here.
        </li>
      </ol>
      <div className="update-token-row">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          aria-label="GitHub token"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn primary" disabled={!token.trim() || saving}>
          {saving ? 'Checking…' : 'Save'}
        </button>
      </div>
      {error && <p className="update-error">{error}</p>}
      <p className="small-print muted">Lumen keeps the token on this computer only, in its settings folder.</p>
    </form>
  );
}

/** The Update button's window: what version this is, whether there's a newer one, and installing it. */
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const u = useUpdates();
  const [replacing, setReplacing] = useState(false);
  const busy = u.status === 'installing';

  const install = async () => {
    const live = useStore.getState().live;
    const showing = !!(live.slide || live.mediaId || live.announcement || live.audioId || live.videoInput);
    const ok = await confirmDialog({
      title: `Install Lumen ${u.found?.version}?`,
      message: `Lumen will download it, install it and restart${showing ? ', which takes everything off the screens for a moment' : ''}. Your library, playlists and settings stay as they are.`,
      confirmLabel: 'Install and Restart',
    });
    if (ok) void installUpdate();
  };

  return (
    <Dialog title="Update" onClose={busy ? () => {} : onClose} className="update-dialog">
      <div className="update-current">
        <span className="update-app">Lumen</span>
        <span className="muted">Version {u.version ?? '…'}</span>
      </div>
      {u.hasToken === false || replacing ? (
        <TokenForm replacing={replacing} onDone={() => setReplacing(false)} />
      ) : (
        <>
          {u.status === 'checking' && <p className="update-status">Checking for updates…</p>}
          {(u.status === 'none' || u.status === 'idle') && (
            <p className="update-status">
              {u.status === 'none' ? 'Lumen is up to date.' : 'Check whether there’s a newer version.'}
              {u.checkedAt && (
                <span className="muted">
                  {' '}
                  Checked {new Date(u.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                </span>
              )}
            </p>
          )}
          {u.status === 'error' && <p className="update-error">{u.error}</p>}
          {(u.status === 'available' || u.status === 'installing') && u.found && (
            <div className="update-found">
              <div className="update-found-head">
                <b>Lumen {u.found.version}</b> is available
                {u.found.date && <span className="muted"> · {u.found.date}</span>}
              </div>
              {u.found.notes && <pre className="update-notes">{u.found.notes}</pre>}
            </div>
          )}
          {u.status === 'installing' && u.progress && (
            <div className="update-progress">
              <progress
                value={u.progress.total ? u.progress.received : undefined}
                max={u.progress.total ?? undefined}
                aria-label="Download progress"
              />
              <span className="muted">
                {u.progress.total && u.progress.received >= u.progress.total ? 'Installing…' : `Downloading ${progressText(u.progress)}`}
              </span>
            </div>
          )}
          <div className="dialog-actions">
            <button className="btn link" disabled={busy} onClick={() => setReplacing(true)}>
              Change Token…
            </button>
            <span className="dialog-actions-spacer" />
            {u.status === 'available' || u.status === 'installing' ? (
              <button className="btn primary" disabled={busy} onClick={() => void install()}>
                {busy ? 'Installing…' : 'Install and Restart'}
              </button>
            ) : (
              <button className="btn primary" disabled={u.status === 'checking'} onClick={() => void checkForUpdates()}>
                Check Now
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
