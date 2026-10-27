import { beforeEach, describe, expect, it } from 'vitest';
import { canRunView, runViewCommand, viewCommandFor, viewEntries } from './components/viewCommands';
import { useStore } from './store';

const s = () => useStore.getState();
const press = (code: string, mods: { meta?: boolean; shift?: boolean } = {}) => ({
  code,
  ctrlKey: true,
  metaKey: !!mods.meta,
  altKey: false,
  shiftKey: !!mods.shift,
});

beforeEach(() => {
  useStore.setState({ mode: 'show', selectedPresentationId: null, selectedPlaylistItemId: null });
  s().updateSettings({ slideView: 'grid', continuousPlaylist: false });
});

describe('The View menu', () => {
  it('has ProPresenter’s Control-key shortcuts', () => {
    expect(viewCommandFor(press('KeyS'), true)).toBe('view-show');
    expect(viewCommandFor(press('KeyE'), true)).toBe('view-edit');
    expect(viewCommandFor(press('KeyR'), true)).toBe('view-reflow');
    expect(viewCommandFor(press('KeyB'), true)).toBe('view-bibles');
    // ⌘⌃S on a Mac, and ⇧⌃S, are something else.
    expect(viewCommandFor(press('KeyS', { meta: true }), true)).toBeNull();
    expect(viewCommandFor(press('KeyS', { shift: true }), true)).toBeNull();
    expect(viewCommandFor({ ...press('KeyS'), ctrlKey: false, metaKey: true }, true)).toBeNull();
    expect(viewCommandFor(press('KeyE'), false)).toBe('view-edit');
  });

  it('switches modes; the editors need a presentation', () => {
    expect(canRunView('view-edit')).toBe(false);
    expect(runViewCommand('view-edit')).toBe(false);
    expect(s().mode).toBe('show');
    runViewCommand('view-bibles');
    expect(s().mode).toBe('bible');
    const id = s().createPresentation({ title: 'Song' }, 'a\n\nb');
    s().select(id);
    runViewCommand('view-reflow');
    expect(s().mode).toBe('reflow');
    runViewCommand('view-edit');
    expect(s().mode).toBe('edit');
    runViewCommand('view-show');
    expect(s().mode).toBe('show');
  });

  it('sets the slide view and Continuous Playlist, with checkmarks', () => {
    runViewCommand('slide-view-easy');
    expect(s().settings.slideView).toBe('easy');
    runViewCommand('slide-view-table');
    expect(s().settings.slideView).toBe('list');
    runViewCommand('continuous-playlist');
    expect(s().settings.continuousPlaylist).toBe(true);
    const entries = viewEntries().filter((e) => e && typeof e === 'object' && 'label' in e) as {
      label: string;
      checked?: boolean;
      submenu?: unknown;
    }[];
    expect(entries.find((e) => e.label === 'Continuous Playlist')?.checked).toBe(true);
    const views = entries.find((e) => e.label === 'Slide View')?.submenu as { label: string; checked?: boolean }[];
    expect(views.filter((v) => v.checked).map((v) => v.label)).toEqual(['Table View']);
  });
});
