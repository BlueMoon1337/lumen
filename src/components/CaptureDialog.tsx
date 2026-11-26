import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AUTO_MATRIX,
  CAPTURE_CODECS,
  CAPTURE_ENCODINGS,
  captureSettings,
  captureSource,
  encodingLabel,
  recorderType,
  SAVE_FOLDERS,
  sameEncoding,
  toggleCapture,
  useCapture,
} from '../capture';
import { useStore } from '../store';
import type { CaptureEncoding, CapturePreset, CaptureSettings } from '../types';
import { uid } from '../util';
import { promptDialog } from './Ask';
import { MenuSelect, type MenuEntry } from './MenuSelect';
import { Dialog, Popover } from './ui';

const NO_PRESETS: CapturePreset[] = [];
const SAVE_PRESET = '\u0000save';
const DELETE_PRESET = '\u0000delete';
const OTHER = '\u0000other';
const CUSTOM = '\u0000custom';

const encodingValue = (e: CaptureEncoding) => `${e.width}x${e.height}@${e.fps}/${e.mbps}`;
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Time since a start, as 0:00:00. */
export function elapsed(since: number, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${p(Math.floor(total / 60) % 60)}:${p(total % 60)}`;
}

export function useElapsed(since: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [since]);
  return since === null ? null : elapsed(since, now);
}

function CustomEncoding({ value, onDone }: { value: CaptureEncoding; onDone: (e: CaptureEncoding | null) => void }) {
  const [e, setE] = useState(value);
  const field = (key: keyof CaptureEncoding, label: string, min: number, max: number) => (
    <label className="cap-custom-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={e[key]}
        onChange={(ev) => setE({ ...e, [key]: Math.round(Math.min(max, Math.max(min, Number(ev.target.value) || min))) })}
        aria-label={label}
      />
    </label>
  );
  return (
    <form
      className="cap-custom"
      onSubmit={(ev) => {
        ev.preventDefault();
        // Encoders want even sizes.
        onDone({ ...e, width: e.width - (e.width % 2), height: e.height - (e.height % 2) });
      }}
    >
      <div className="pop-title">Custom Encoding</div>
      <div className="cap-custom-grid">
        {field('width', 'Width', 160, 7680)}
        {field('height', 'Height', 90, 4320)}
        {field('fps', 'Frame Rate', 1, 60)}
        {field('mbps', 'Mbps', 1, 200)}
      </div>
      <div className="pop-foot">
        <button type="button" className="btn small" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" className="btn small primary">
          OK
        </button>
      </div>
    </form>
  );
}

function Routing({ audio, onChange }: { audio: CaptureSettings['audio']; onChange: (a: CaptureSettings['audio']) => void }) {
  const matrix = audio.auto ? AUTO_MATRIX : audio.matrix;
  return (
    <div className="cap-routing">
      <label className="cap-auto">
        <span>Auto</span>
        <label className="switch" title="Lumen's left channel to the left, right to the right">
          <input
            type="checkbox"
            checked={audio.auto}
            onChange={(e) => onChange({ ...audio, auto: e.target.checked })}
            aria-label="Auto routing"
          />
          <span />
        </label>
      </label>
      <table className={`cap-matrix ${audio.auto ? 'auto' : ''}`}>
        <thead>
          <tr>
            <th />
            <th colSpan={2}>Output Channel</th>
          </tr>
          <tr>
            <th />
            <th>L</th>
            <th>R</th>
          </tr>
        </thead>
        <tbody>
          {(['Lumen Channel 1', 'Lumen Channel 2'] as const).map((name, input) => (
            <tr key={name}>
              <th>{name}</th>
              {[0, 1].map((output) => (
                <td key={output}>
                  <button
                    className={`cap-cell ${matrix[input][output] ? 'on' : ''}`}
                    disabled={audio.auto}
                    role="checkbox"
                    aria-checked={matrix[input][output]}
                    aria-label={`${name} to ${output ? 'right' : 'left'}`}
                    onClick={() => {
                      const next = matrix.map((row) => [...row]) as CaptureSettings['audio']['matrix'];
                      next[input][output] = !next[input][output];
                      onChange({ ...audio, matrix: next });
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small-print muted">The Audio layer and the live video’s sound.</p>
    </div>
  );
}

/** Screens ▸ Capture Settings…: what to record, where, and how. */
export function CaptureDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore(useShallow((s) => captureSettings(s)));
  const presets = useStore((s) => s.settings.capturePresets ?? NO_PRESETS);
  const presetId = useStore((s) => s.settings.capturePresetId);
  const audience = useStore(useShallow((s) => s.screens.screens.filter((sc) => sc.kind === 'audience')));
  const capture = useCapture();
  const time = useElapsed(capture.startedAt);
  const [routing, setRouting] = useState(false);
  const [custom, setCustom] = useState(false);
  const s = useStore.getState();
  const desktop = window.lumenDesktop;
  const preset = presets.find((p) => p.id === presetId);
  const locked = capture.recording;

  // A change makes the settings no preset's.
  const set = (patch: Partial<CaptureSettings>) => s.updateSettings({ capture: { ...settings, ...patch }, capturePresetId: undefined });

  const choosePreset = async (v: string) => {
    if (v === SAVE_PRESET) {
      const name = await promptDialog({
        title: 'Save Preset',
        message: 'A name for these capture settings:',
        placeholder: 'Preset name',
        defaultValue: preset?.name,
      });
      if (!name?.trim()) return;
      const existing = presets.find((p) => p.name === name.trim());
      const id = existing?.id ?? uid();
      const next = { id, name: name.trim(), settings };
      s.updateSettings({
        capturePresets: existing ? presets.map((p) => (p.id === id ? next : p)) : [...presets, next],
        capturePresetId: id,
      });
    } else if (v === DELETE_PRESET) {
      s.updateSettings({ capturePresets: presets.filter((p) => p.id !== presetId), capturePresetId: undefined });
    } else {
      const p = presets.find((x) => x.id === v);
      s.updateSettings({ capturePresetId: p?.id, ...(p ? { capture: structuredClone(p.settings) } : {}) });
    }
  };

  const chooseFolder = async (v: string) => {
    if (v !== OTHER) return set({ saveTo: v });
    const path = await desktop?.chooseCaptureFolder();
    if (path) set({ saveTo: path });
  };

  const presetEntries: MenuEntry[] = [
    { type: 'item', value: '', label: 'No Preset' },
    ...presets.map((p): MenuEntry => ({ type: 'item', value: p.id, label: p.name })),
    { type: 'separator' },
    { type: 'item', value: SAVE_PRESET, label: preset ? 'Update or Save Preset…' : 'Save Preset…', checked: false },
    ...(preset
      ? [{ type: 'item', value: DELETE_PRESET, label: `Delete “${preset.name}”`, checked: false, danger: true } as MenuEntry]
      : []),
  ];
  const known = SAVE_FOLDERS.some((f) => f.id === settings.saveTo);
  const folderEntries: MenuEntry[] = [
    ...SAVE_FOLDERS.map((f): MenuEntry => ({ type: 'item', value: f.id, label: f.label })),
    ...(known ? [] : [{ type: 'item', value: settings.saveTo, label: folderName(settings.saveTo), title: settings.saveTo } as MenuEntry]),
    { type: 'separator' },
    { type: 'item', value: OTHER, label: 'Other Location…', checked: false },
  ];
  const codecEntries: MenuEntry[] = CAPTURE_CODECS.map((c) => {
    const ok = !!recorderType(c.id);
    return {
      type: 'item',
      value: c.id,
      label: c.label,
      disabled: !ok,
      title: ok ? undefined : c.types.length ? 'This computer can’t record it' : 'Needs an encoder Lumen doesn’t have',
    };
  });
  const isPreset = CAPTURE_ENCODINGS.some((e) => sameEncoding(e, settings.encoding));
  const encodingEntries: MenuEntry[] = [
    ...CAPTURE_ENCODINGS.map(
      (e): MenuEntry => ({
        type: 'item',
        value: encodingValue(e),
        label: encodingLabel(e),
        title: `${e.width} × ${e.height}`,
      }),
    ),
    ...(isPreset
      ? []
      : [
          { type: 'separator' } as MenuEntry,
          { type: 'item', value: encodingValue(settings.encoding), label: encodingLabel(settings.encoding) } as MenuEntry,
        ]),
    { type: 'separator' },
    { type: 'item', value: CUSTOM, label: 'Custom Encoding…', checked: false },
  ];
  const source = captureSource(audience, settings.sourceScreenId);
  const codecOk = !!recorderType(settings.codec);

  return (
    <Dialog title="Capture" onClose={onClose} className="capture-dialog">
      <div className="cap-form">
        <span className="cap-label">Preset</span>
        <MenuSelect
          label="Preset"
          value={preset?.id ?? ''}
          entries={presetEntries}
          onChange={(v) => void choosePreset(v)}
          disabled={locked}
        />
        <span className="cap-label">Source</span>
        <MenuSelect
          label="Source"
          value={source?.id ?? ''}
          entries={
            audience.length
              ? audience.map((sc) => ({ type: 'item', value: sc.id, label: sc.name }))
              : [{ type: 'note', text: 'No audience screens' }]
          }
          display={source?.name ?? 'No audience screen'}
          onChange={(v) => set({ sourceScreenId: v })}
          disabled={locked}
        />
        <span className="cap-label">Destination</span>
        <MenuSelect
          label="Destination"
          value="disk"
          entries={[{ type: 'item', value: 'disk', label: 'Disk' }]}
          onChange={() => {}}
          disabled={locked}
        />
        <span className="cap-label">Save To</span>
        {desktop ? (
          <MenuSelect
            label="Save to"
            value={settings.saveTo}
            entries={folderEntries}
            onChange={(v) => void chooseFolder(v)}
            disabled={locked}
          />
        ) : (
          <span className="cap-note muted">Your browser’s Downloads</span>
        )}
        <span className="cap-label">Codec</span>
        <MenuSelect
          label="Codec"
          value={settings.codec}
          entries={codecEntries}
          onChange={(v) => set({ codec: v as CaptureSettings['codec'] })}
          disabled={locked}
        />
        <span className="cap-label">Encoding</span>
        <div className="popover-anchor">
          <MenuSelect
            label="Encoding"
            value={encodingValue(settings.encoding)}
            entries={encodingEntries}
            onChange={(v) => {
              if (v === CUSTOM) return setCustom(true);
              const e = [...CAPTURE_ENCODINGS, settings.encoding].find((x) => encodingValue(x) === v);
              if (e) set({ encoding: e });
            }}
            disabled={locked}
          />
          <Popover open={custom} onClose={() => setCustom(false)} className="cap-custom-pop">
            <CustomEncoding
              value={settings.encoding}
              onDone={(e) => {
                setCustom(false);
                if (e) set({ encoding: e });
              }}
            />
          </Popover>
        </div>
        <span className="cap-label">Audio</span>
        <div className="popover-anchor">
          <button className="btn cap-routing-btn" onClick={() => setRouting(!routing)} disabled={locked}>
            Routing…
          </button>
          <Popover open={routing} onClose={() => setRouting(false)} className="cap-routing-pop">
            <Routing audio={settings.audio} onChange={(audio) => set({ audio })} />
          </Popover>
        </div>
      </div>
      {!codecOk && (
        <p className="small-print cap-warning">
          This computer can’t record {CAPTURE_CODECS.find((c) => c.id === settings.codec)?.label}. Choose another codec.
        </p>
      )}
      {capture.recording && (
        <p className="small-print muted cap-file" title={capture.file ?? ''}>
          Recording to {capture.file}
        </p>
      )}
      <button
        className={`btn cap-start ${capture.recording ? 'recording' : ''}`}
        disabled={capture.stopping || (!capture.recording && (!codecOk || !source))}
        onClick={() => void toggleCapture()}
      >
        {capture.stopping ? 'Finishing…' : capture.recording ? `Stop Capture  ${time}` : 'Start Capture'}
      </button>
    </Dialog>
  );
}
