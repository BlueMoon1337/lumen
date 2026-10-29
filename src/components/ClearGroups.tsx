import type { CSSProperties } from 'react';
import { CLEAR_GROUP_ICONS, clearGroupsOf, DEFAULT_CLEAR_GROUPS, isLayerLive, layerLabel, LAYERS } from '../layers';
import { useStore } from '../store';
import type { ClearGroup, ClearLayer } from '../types';
import { uid } from '../util';
import { confirmThen } from './Ask';
import { undoHint } from './deleting';
import { openContextMenu } from './ContextMenu';
import { MenuSelect } from './MenuSelect';
import { Dialog, Icon, IconButton, type IconName } from './ui';

const editGroups = () => useStore.getState().setUI({ dialog: 'clearGroups' });

/**
 * ProPresenter's Clear Groups, under the preview: each button clears several layers at once,
 * e.g. all the text but not the background or the music. Lit while any of its layers is live.
 */
export function ClearGroupsRow() {
  const groups = useStore((s) => clearGroupsOf(s.settings));
  const live = useStore((s) => s.live);
  const s = useStore.getState();
  return (
    <div className="clear-groups" onContextMenu={(e) => openContextMenu(e, [{ label: 'Edit Clear Groups…', action: editGroups }])}>
      {groups.map((g) => {
        const active = g.layers.some((l) => isLayerLive(live, l));
        return (
          <button
            key={g.id}
            type="button"
            className={`clear-group ${active ? 'active' : ''}`}
            style={{ '--group-color': g.color } as CSSProperties}
            disabled={!active}
            title={`${g.name}: ${g.layers.map(layerLabel).join(', ')}`}
            aria-label={g.name}
            onClick={() => s.clearLayers(g.layers)}
            onContextMenu={(e) =>
              openContextMenu(e, [
                { label: g.name, disabled: !active, action: () => s.clearLayers(g.layers) },
                '-',
                { label: 'Edit Clear Groups…', action: editGroups },
              ])
            }
          >
            <Icon name={g.icon as IconName} size={17} />
          </button>
        );
      })}
      <IconButton icon="gear" title="Edit Clear Groups" onClick={editGroups} />
      <PlayOutro />
    </div>
  );
}

/** Play Outro: the active outro (Media ▸ Outro, the one with a bookmark) on the Media layer. */
function PlayOutro() {
  const outro = useStore((s) => s.media.find((m) => m.id === s.settings.outroMediaId));
  const playing = useStore((s) => !!outro && s.live.mediaId === outro.id);
  const s = useStore.getState();
  return (
    <button
      type="button"
      className={`play-outro ${playing ? 'active' : ''}`}
      disabled={!outro}
      title={
        outro
          ? playing
            ? `Playing the outro “${outro.name}”: click to play it from the start`
            : `Play Outro: “${outro.name}”`
          : 'Play Outro: no outro yet. Right-click a video in the media bin ▸ Active Outro.'
      }
      aria-label="Play Outro"
      onClick={s.playOutro}
      onContextMenu={(e) =>
        openContextMenu(e, [
          { label: 'Play Outro', disabled: !outro, action: s.playOutro },
          '-',
          { label: 'Choose the Outro…', action: () => s.setUI({ mode: 'show', showMediaBin: true, mediaFilter: 'outro' }) },
        ])
      }
    >
      <Icon name="outro" size={15} />
      <span>Outro</span>
    </button>
  );
}

/** Adds, names, colors and picks the layers of the clear groups. */
export function ClearGroupsDialog({ onClose }: { onClose: () => void }) {
  const groups = useStore((s) => clearGroupsOf(s.settings));
  const s = useStore.getState();
  const save = (next: ClearGroup[] | undefined) => s.updateSettings({ clearGroups: next });
  const update = (id: string, patch: Partial<ClearGroup>) => save(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const toggle = (g: ClearGroup, layer: ClearLayer) =>
    update(g.id, {
      layers: g.layers.includes(layer)
        ? g.layers.filter((l) => l !== layer)
        : LAYERS.map((l) => l.id).filter((l) => l === layer || g.layers.includes(l)),
    });

  return (
    <Dialog title="Clear Groups" onClose={onClose} className="clear-groups-dialog">
      <p className="muted small-print">
        Each button under the preview clears the layers ticked here in one click, e.g. the words but not the background or the music.
      </p>
      <div className="cg-list">
        {groups.map((g) => (
          <div key={g.id} className="cg-row">
            <div className="cg-head">
              <MenuSelect
                className="cg-icon"
                label="Icon"
                value={g.icon}
                display={
                  <span style={{ color: g.color }}>
                    <Icon name={g.icon as IconName} size={18} />
                  </span>
                }
                entries={CLEAR_GROUP_ICONS.map((icon) => ({
                  type: 'item',
                  value: icon.name,
                  label: (
                    <span className="cg-icon-choice">
                      <Icon name={icon.name} size={16} /> {icon.label}
                    </span>
                  ),
                }))}
                onChange={(icon) => update(g.id, { icon })}
              />
              <input type="color" value={g.color} onChange={(e) => update(g.id, { color: e.target.value })} aria-label="Color" />
              <input className="cg-name" value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} aria-label="Name" />
              <IconButton icon="trash" title="Delete this clear group" danger onClick={() => save(groups.filter((x) => x.id !== g.id))} />
            </div>
            <div className="cg-layers">
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`cg-layer ${g.layers.includes(l.id) ? 'on' : ''}`}
                  aria-pressed={g.layers.includes(l.id)}
                  title={l.label}
                  onClick={() => toggle(g, l.id)}
                >
                  <Icon name={l.icon} size={14} />
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="muted">No clear groups. Add one below.</p>}
      </div>
      <div className="button-row">
        <button
          className="btn"
          onClick={() =>
            save([...groups, { id: uid(), name: 'New Clear Group', icon: 'close', color: '#3b82f6', layers: ['slide', 'messages'] }])
          }
        >
          Add Clear Group
        </button>
        <button
          className="btn"
          disabled={groups === DEFAULT_CLEAR_GROUPS}
          onClick={() =>
            confirmThen({ title: 'Put back the standard clear groups?', message: undoHint(), confirmLabel: 'Restore' }, () =>
              save(undefined),
            )
          }
        >
          Restore Defaults
        </button>
      </div>
    </Dialog>
  );
}
