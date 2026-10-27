import { beforeEach, describe, expect, it } from 'vitest';
import { newPresentation } from './commands';
import { buildFrame } from './frame';
import { getSequence } from './lyrics';
import { useStore } from './store';
import { resolveTheme, slideTheme } from './theme';

const s = () => useStore.getState();

beforeEach(() => s().clearAll());

describe('New Presentation', () => {
  it('starts with one blank, transparent slide, open in the editor', () => {
    const id = newPresentation('song');
    const p = s().presentations[id];
    expect(p.groups.map((g) => g.name)).toEqual(['Group']);
    expect(getSequence(p).map((e) => e.slide.text)).toEqual(['']);
    expect(p.background?.type).toBe('none');
    expect(s()).toMatchObject({ mode: 'edit', selectedPresentationId: id, editSlideId: p.groups[0].slides[0].id });
    // Shown, it covers nothing: no background behind it.
    s().goLive(id, 0);
    expect(buildFrame(s()).background).toBeNull();
  });

  it('a presentation’s background replaces the theme’s, and a slide’s replaces both', () => {
    const id = s().createPresentation({ title: 'Song' }, 'a\n\nb');
    const p = () => s().presentations[id];
    const theme = resolveTheme(s(), p());
    expect(slideTheme(theme, p(), undefined).background).toEqual(theme.background);
    s().updatePresentation(id, { background: { type: 'color', color: '#112233', color2: '#112233' } });
    const slide = getSequence(p())[0].slide;
    expect(slideTheme(theme, p(), slide).background.color).toBe('#112233');
    // The same inputs give the same theme, so thumbnails don't redraw for nothing.
    expect(slideTheme(theme, p(), slide)).toBe(slideTheme(theme, p(), slide));
    s().goLive(id, 0);
    expect(buildFrame(s()).background).toMatchObject({ kind: 'color', color: '#112233' });
    s().updateSlide(id, slide.id, { background: { type: 'color', color: '#445566', color2: '#445566' } });
    s().goLive(id, 0);
    expect(buildFrame(s()).background).toMatchObject({ kind: 'color', color: '#445566' });
  });
});
