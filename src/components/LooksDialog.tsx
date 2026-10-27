import { useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_LOOK, LOOK_LAYERS, lookScreen, MASKS, sameLook } from '../looks';
import { notify } from '../notices';
import { useStore } from '../store';
import type { Look, LookScreen } from '../types';
import { confirmDialog, promptDialog } from './Ask';
import { undoHint } from './deleting';
import { NamePopup, openContextMenu, openPopupAtMenu, type ContextEntries } from './ContextMenu';
import { Dialog, Icon, IconButton, Popover } from './ui';

const LIVE = 'live';

async function saveAsNew(look: Look) {
  const name = await promptDialog({
    title: 'Save Look',
    message: 'A name for the new preset:',
    defaultValue: `${look.name} copy`,
    placeholder: 'Look name',
  });
  if (!name?.trim()) return null;
  return useStore.getState().saveLook({ ...look, id: '', name: name.trim() });
}

async function deleteLook(look: Look) {
  const s = useStore.getState();
  if (s.looks.length <= 1) return notify('The last look stays, to have one to go back to.');
  if (!(await confirmDialog({ title: `Delete the look “${look.name}”?`, message: undoHint(), confirmLabel: 'Delete', danger: true })))
    return;
  s.deleteLook(look.id);
}

function presetMenu(look: Look, select: (id: string) => void): ContextEntries {
  const s = useStore.getState();
  return [
    { label: 'Make Live', action: () => s.triggerLook(look.id) },
    '-',
    {
      label: 'Rename…',
      action: () =>
        openPopupAtMenu(
          <NamePopup
            title="Rename Look"
            colors={false}
            initial={{ name: look.name, color: '' }}
            onSave={(v) => s.saveLook({ ...look, name: v.name })}
          />,
        ),
    },
    {
      label: 'Duplicate',
      action: () => select(s.saveLook({ ...look, id: '', name: `${look.name} copy` })),
    },
    '-',
    { label: 'Delete', danger: true, disabled: s.looks.length <= 1, action: () => void deleteLook(look) },
  ];
}

/**
 * Screens ▸ Edit Looks…: what each audience screen shows. Live changes the screens as you go;
 * a preset is changed here and kept with Save, and goes on the screens from Screens ▸ Live.
 */
export function LooksDialog({ onClose }: { onClose: () => void }) {
  const looks = useStore((s) => s.looks);
  const live = useStore((s) => s.liveLook);
  const themes = useStore((s) => s.themes);
  const identify = useStore((s) => s.screenTools.identify);
  const fadeMs = useStore((s) => s.settings.lookFadeMs ?? 1000);
  const screens = useStore(useShallow((s) => s.screens.screens.filter((sc) => sc.kind === 'audience')));
  const [selected, setSelected] = useState(LIVE);
  const [draft, setDraft] = useState<Look | null>(null);
  const [help, setHelp] = useState(false);
  const s = useStore.getState();

  const preset = selected === LIVE ? null : looks.find((l) => l.id === selected);
  const shown = selected === LIVE ? live : (draft ?? preset ?? DEFAULT_LOOK);
  const ids = screens.map((sc) => sc.id);
  const livePreset = looks.find((l) => l.id === live.id);
  const liveEdited = !livePreset || !sameLook(live, livePreset, ids);
  const dirty = selected === LIVE ? liveEdited : !!draft && !!preset && (draft.name !== preset.name || !sameLook(draft, preset, ids));

  const select = (id: string) => {
    setSelected(id);
    setDraft(null);
  };

  const change = (screenId: string, patch: Partial<LookScreen>) => {
    if (selected === LIVE) s.updateLiveLook(screenId, patch);
    else setDraft({ ...shown, screens: { ...shown.screens, [screenId]: { ...lookScreen(shown, screenId), ...patch } } });
  };

  const save = async () => {
    if (selected === LIVE) {
      // Live keeps its changes in the preset it came from, or in a new one.
      if (livePreset) s.saveLook(live);
      else {
        const id = await saveAsNew(live);
        if (id)
          useStore.setState((st) => ({
            liveLook: { ...st.liveLook, id, name: st.looks.find((l) => l.id === id)?.name ?? st.liveLook.name },
          }));
      }
    } else if (draft) {
      s.saveLook(draft);
      setDraft(null);
    }
  };

  return (
    <Dialog title="Looks" onClose={onClose} className="looks-dialog">
      <div className="looks">
        <aside className="looks-side">
          <button
            className={`looks-live ${selected === LIVE ? 'selected' : ''}`}
            onClick={() => select(LIVE)}
            onContextMenu={(e) => openContextMenu(e, [{ label: 'Save as New Preset…', action: () => void saveAsNew(live) }])}
          >
            <span className="looks-live-tag">Live</span>
            <span className="list-label">
              {live.name}
              {liveEdited && ' (edited)'}
            </span>
          </button>
          <div className="looks-presets-header">
            <span>Presets</span>
            <IconButton icon="plus" title="New preset from Live" onClick={() => void saveAsNew(live).then((id) => id && select(id))} />
          </div>
          <div className="looks-presets">
            {looks.map((l) => (
              <button
                key={l.id}
                className={`looks-preset ${selected === l.id ? 'selected' : ''}`}
                onClick={() => select(l.id)}
                onDoubleClick={() => s.triggerLook(l.id)}
                onContextMenu={(e) => openContextMenu(e, presetMenu(l, select))}
                title="Double-click to make it live · Right-click for more"
              >
                <span className="list-label">{l.name}</span>
                {l.id === live.id && <span className="looks-live-dot" title="Live" />}
              </button>
            ))}
          </div>
        </aside>
        <section className="looks-main">
          <header className="looks-head">
            {preset ? (
              <input
                className="looks-name"
                value={shown.name}
                onChange={(e) => setDraft({ ...shown, name: e.target.value })}
                aria-label="Look name"
              />
            ) : (
              <h3 className="looks-name">Live — {live.name}</h3>
            )}
            <button className={`btn small ${identify ? 'active' : ''}`} onClick={() => s.setScreenTools({ identify: !identify })}>
              {identify ? 'Disable Identify' : 'Enable Identify'}
            </button>
            {preset && (
              <button className="btn small" onClick={() => s.triggerLook(preset.id)} title="Put this look on the screens">
                Make Live
              </button>
            )}
            <button className="btn small primary" disabled={!dirty} onClick={() => void save()}>
              Save
            </button>
          </header>
          {screens.length === 0 ? (
            <p className="muted looks-empty">Add an audience screen in Screens ▸ Configure Screens… to choose what it shows.</p>
          ) : (
            <div className="looks-grid" style={{ gridTemplateColumns: `150px repeat(${screens.length}, minmax(130px, 1fr))` }}>
              <span />
              {screens.map((sc) => (
                <span key={sc.id} className="looks-screen-name">
                  <Icon name="monitor" size={14} /> {sc.name}
                </span>
              ))}
              <span className="looks-row-label">Mask</span>
              {screens.map((sc) => (
                <select
                  key={sc.id}
                  value={lookScreen(shown, sc.id).mask ?? 'none'}
                  onChange={(e) => change(sc.id, { mask: e.target.value as LookScreen['mask'] })}
                  aria-label={`Mask on ${sc.name}`}
                >
                  {MASKS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id === 'none' ? '⊘ None' : m.label}
                    </option>
                  ))}
                </select>
              ))}
              {LOOK_LAYERS.map((layer) => (
                <LookRow key={layer.key} label={layer.label}>
                  {screens.map((sc) => {
                    const on = lookScreen(shown, sc.id)[layer.key];
                    return (
                      <button
                        key={sc.id}
                        className={`looks-check ${on ? 'on' : ''}`}
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`${layer.label} on ${sc.name}`}
                        onClick={() => change(sc.id, { [layer.key]: !on })}
                      >
                        {on && '✓'}
                      </button>
                    );
                  })}
                  {layer.key === 'announcements' && (
                    <>
                      <span className="looks-row-label">Presentation</span>
                      {screens.map((sc) => (
                        <select
                          key={sc.id}
                          value={lookScreen(shown, sc.id).themeId ?? ''}
                          onChange={(e) => change(sc.id, { themeId: e.target.value || undefined })}
                          aria-label={`Theme on ${sc.name}`}
                          title="Show the slides in another theme on this screen (a lower third for a stream, say)"
                        >
                          <option value="">⊘ Slide’s Own Theme</option>
                          {themes.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      ))}
                    </>
                  )}
                </LookRow>
              ))}
            </div>
          )}
          <footer className="looks-foot">
            <label className="looks-fade" title="How long a layer takes to fade when a look turns it on or off">
              <Icon name="film" size={14} />
              <input
                type="range"
                min={0}
                max={3000}
                step={100}
                value={fadeMs}
                onChange={(e) => s.updateSettings({ lookFadeMs: Number(e.target.value) })}
                aria-label="Look transition"
              />
              <span>{(fadeMs / 1000).toFixed(1)}s</span>
            </label>
            <div className="popover-anchor">
              <button className="btn small looks-help" onClick={() => setHelp(!help)} aria-label="About looks">
                ?
              </button>
              <Popover open={help} onClose={() => setHelp(false)} align="right" className="looks-help-pop">
                <p>
                  A look says what each audience screen shows: which layers, the slides in a theme of its own, and a mask over part of the
                  screen.
                </p>
                <p>
                  <b>Live</b> is what the screens show now; changes to it show straight away. Change a <b>preset</b> and Save it, then put
                  it on the screens with Screens ▸ Live (or double-click it here).
                </p>
              </Popover>
            </div>
          </footer>
        </section>
      </div>
    </Dialog>
  );
}

function LookRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="looks-row-label">{label}</span>
      {children}
    </>
  );
}
