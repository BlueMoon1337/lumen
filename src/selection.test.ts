import { describe, expect, it } from 'vitest';
import { actedOn, clickSelection } from './selection';

const none = { metaKey: false, ctrlKey: false, shiftKey: false };
const order = ['a', 'b', 'c', 'd', 'e'];

describe('highlighting several items', () => {
  it('chooses one with a click, adds or removes with ⌘-click, takes a range with ⇧-click', () => {
    let sel = clickSelection({ ids: [], anchor: null }, order, 'b', none);
    expect(sel).toEqual({ ids: ['b'], anchor: 'b' });
    sel = clickSelection(sel, order, 'd', { ...none, shiftKey: true });
    expect(sel.ids).toEqual(['b', 'c', 'd']);
    sel = clickSelection(sel, order, 'c', { ...none, metaKey: true });
    expect(sel.ids).toEqual(['b', 'd']);
    sel = clickSelection(sel, order, 'e', { ...none, ctrlKey: true });
    expect(sel).toEqual({ ids: ['b', 'd', 'e'], anchor: 'e' });
    sel = clickSelection(sel, order, 'a', none);
    expect(sel.ids).toEqual(['a']);
  });

  it('acts on the highlight when the item is in it, in the order shown', () => {
    expect(actedOn({ ids: ['d', 'b'], anchor: 'd' }, order, 'b')).toEqual(['b', 'd']);
    expect(actedOn({ ids: ['d', 'b'], anchor: 'd' }, order, 'a')).toEqual(['a']);
    expect(actedOn({ ids: ['b'], anchor: 'b' }, order, 'b')).toEqual(['b']);
  });
});
