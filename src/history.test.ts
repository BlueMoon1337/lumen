import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BIBLE_DRAFT_ID } from './bibleSlides';
import { clearHistory, installHistory, redo, undo, undoBatch, useHistory } from './history';
import { useStore } from './store';

installHistory();

const s = () => useStore.getState();
const make = (text = '[Verse 1]\na\n\nb\n\nc') => {
  const id = s().createPresentation({ title: 'Song' }, text);
  return () => s().presentations[id];
};
const texts = (p: ReturnType<ReturnType<typeof make>>) => p.groups.flatMap((g) => g.slides.map((sl) => sl.text));

describe('undo and redo', () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearHistory();
  });

  it('undoes and redoes a step, naming it', () => {
    const get = make();
    clearHistory();
    s().deleteSlide(get().id, get().groups[0].slides[1].id);
    expect(texts(get())).toEqual(['a', 'c']);
    expect(useHistory.getState().undo).toBe('Delete Slide');
    expect(undo()).toBe('Delete Slide (Song)');
    expect(texts(get())).toEqual(['a', 'b', 'c']);
    expect(useHistory.getState()).toEqual({ undo: null, redo: 'Delete Slide' });
    redo();
    expect(texts(get())).toEqual(['a', 'c']);
    expect(useHistory.getState()).toEqual({ undo: 'Delete Slide', redo: null });
  });

  it('makes one step of an action that calls others', () => {
    const get = make();
    clearHistory();
    const [a, b] = get().groups[0].slides;
    s().copyTextStyle(get().id, a.id);
    s().cutSlides(get().id, [b.id, a.id]);
    expect(texts(get())).toEqual(['c']);
    undo();
    expect(texts(get())).toEqual(['a', 'b', 'c']);
    expect(useHistory.getState()).toEqual({ undo: null, redo: 'Cut' });
  });

  it('joins typing in one field into one step, but not different fields', () => {
    const get = make();
    clearHistory();
    for (const title of ['A', 'Am', 'Ama', 'Amazing']) s().updatePresentation(get().id, { title });
    s().updatePresentation(get().id, { author: 'John Newton' });
    expect(get().title).toBe('Amazing');
    undo();
    expect(get().author).toBeUndefined();
    expect(get().title).toBe('Amazing');
    undo();
    expect(get().title).toBe('Song');
  });

  it('keeps edits more than a second apart as separate steps', () => {
    vi.useFakeTimers();
    const get = make();
    clearHistory();
    s().updatePresentation(get().id, { title: 'One' });
    vi.advanceTimersByTime(1500);
    s().updatePresentation(get().id, { title: 'Two' });
    undo();
    expect(get().title).toBe('One');
  });

  it('batches several actions into one step', () => {
    const get = make();
    clearHistory();
    undoBatch('Apply to All Slides', () => {
      s().updatePresentation(get().id, { style: { color: '#ff0000' } });
      s().updateSlide(get().id, get().groups[0].slides[0].id, { style: { color: '#00ff00' } });
    });
    expect(useHistory.getState().undo).toBe('Apply to All Slides');
    undo();
    expect(get().style).toBeUndefined();
    expect(get().groups[0].slides[0].style).toBeUndefined();
    expect(useHistory.getState().undo).toBeNull();
  });

  it('forgets redo after a new edit', () => {
    const get = make();
    clearHistory();
    s().addSlide(get().id);
    undo();
    s().updatePresentation(get().id, { title: 'New' });
    expect(useHistory.getState().redo).toBeNull();
  });

  it('leaves showing slides, panes and Bible mode alone', () => {
    const get = make();
    clearHistory();
    s().goLive(get().id, 1);
    s().updateSettings({ panes: { side: 400 }, gridSize: 300 });
    s().setBibleDraft({ title: 'John 3:16', groups: [], arrangement: [] });
    expect(useHistory.getState().undo).toBeNull();
    s().deleteSlide(get().id, get().groups[0].slides[2].id);
    s().setBibleDraft({ title: 'John 3:17', groups: [], arrangement: [] });
    undo();
    expect(texts(get())).toEqual(['a', 'b', 'c']);
    expect(s().live.slide).toMatchObject({ presentationId: get().id, index: 1 });
    expect(s().settings.panes).toEqual({ side: 400 });
    expect(s().presentations[BIBLE_DRAFT_ID].title).toBe('John 3:17');
  });

  it('clears the selection and screen when undo removes what they show', () => {
    clearHistory();
    const get = make();
    s().select(get().id);
    s().goLive(get().id, 0);
    undo();
    expect(get()).toBeUndefined();
    expect(s().selectedPresentationId).toBeNull();
    expect(s().live.slide).toBeNull();
    redo();
    expect(get().title).toBe('Song');
  });

  it('brings back deleted media and settings', () => {
    clearHistory();
    useStore.setState({ media: [{ id: 'm1', name: 'Clouds', kind: 'image', mime: 'image/png' }] });
    clearHistory();
    s().updateSettings({ logoMediaId: 'm1' });
    s().deleteMedia('m1');
    expect(s().media).toEqual([]);
    expect(s().settings.logoMediaId).toBeUndefined();
    undo();
    expect(s().media.map((m) => m.name)).toEqual(['Clouds']);
    expect(s().settings.logoMediaId).toBe('m1');
    s().updateSettings({ transition: { kind: 'cut', ms: 0 } });
    expect(useHistory.getState().undo).toBe('Global Transition');
    undo();
    expect(s().settings.transition.kind).toBe('dissolve');
  });
});
