import { beforeEach, describe, expect, it } from 'vitest';
import { getSequence } from './lyrics';
import { useStore } from './store';

const s = () => useStore.getState();
beforeEach(() => s().clearAll());

describe('Slide labels', () => {
  it('go on several slides at once, and come off again', () => {
    const id = s().createPresentation({ title: 'Song' }, 'a\n\nb\n\nc');
    const ids = getSequence(s().presentations[id]).map((e) => e.slide.id);
    s().setSlideLabels(id, [ids[0], ids[2]], { name: 'Random', color: '#d9485f' });
    const labels = () => getSequence(s().presentations[id]).map((e) => e.slide.label?.name ?? null);
    expect(labels()).toEqual(['Random', null, 'Random']);
    s().setSlideLabels(id, [ids[0], ids[2]], undefined);
    expect(labels()).toEqual([null, null, null]);
  });
});
