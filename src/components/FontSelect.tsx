import { useMemo } from 'react';
import { addFontFiles } from '../commands';
import { BUNDLED_FONTS, cssFamilyFor, FONT_ACCEPT, fontLabel, fontValue, SYSTEM_FONTS, type FontChoice } from '../fonts';
import { useStore } from '../store';
import { promptDialog } from './Ask';
import { pickFiles } from './ui';

const CURRENT = '__current';
const INSTALLED = '__installed';
const ADD = '__add';

export function useFontChoices() {
  const fonts = useStore((s) => s.fonts);
  return useMemo(() => {
    const builtIn = new Set([...SYSTEM_FONTS, ...BUNDLED_FONTS].map((c) => c.value));
    // An added font that matches a built-in entry (e.g. a Copperplate file) is reached through that entry.
    const added: FontChoice[] = [...new Set(fonts.map((f) => f.family))]
      .filter((family) => !builtIn.has(cssFamilyFor(family)))
      .sort((a, b) => a.localeCompare(b))
      .map((family) => ({ label: family, value: fontValue(family) }));
    const groups = [
      { label: 'System', choices: SYSTEM_FONTS },
      { label: 'Included with Lumen', choices: BUNDLED_FONTS },
      { label: 'Added fonts', choices: added },
    ];
    return { groups, all: groups.flatMap((g) => g.choices) };
  }, [fonts]);
}

/** Font menu with system, bundled and added fonts, plus ways to use any other font. */
export function FontSelect({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
  const { groups, all } = useFontChoices();
  const known = all.some((c) => c.value === value);

  const choose = async (v: string) => {
    if (v === ADD) {
      const [first] = await addFontFiles(await pickFiles(FONT_ACCEPT));
      if (first) onChange(cssFamilyFor(first.family));
    } else if (v === INSTALLED) {
      const name = await promptDialog({
        title: 'Use a font installed on this computer',
        message: 'Type its name as your font list shows it, for example “Avenir Next”.',
        placeholder: 'Font name',
        confirmLabel: 'Use Font',
      });
      if (name) onChange(cssFamilyFor(name));
    } else if (v !== CURRENT) onChange(v);
  };

  return (
    <select className={className} value={known ? value : CURRENT} onChange={(e) => void choose(e.target.value)} aria-label="Font">
      {!known && <option value={CURRENT}>{fontLabel(value, all)}</option>}
      {groups.map(
        (g) =>
          g.choices.length > 0 && (
            <optgroup key={g.label} label={g.label}>
              {g.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ),
      )}
      <optgroup label="More">
        <option value={INSTALLED}>Font installed on this computer…</option>
        <option value={ADD}>Add font file…</option>
      </optgroup>
    </select>
  );
}
