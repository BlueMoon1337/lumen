import { beforeEach, describe, expect, it } from 'vitest';
import { enabledCommands } from './components/editCommands';
import { slideMenu } from './components/menus';
import { planImport, presentationFile, readLumenFile, zipFile } from './fileFormats';
import { buildFrame } from './frame';
import { getSequence } from './lyrics';
import { isReadOnly, ownFiles, slideWords, withoutMissingFiles } from './slideshows';
import { useStore } from './store';
import type { Presentation } from './types';

const s = () => useStore.getState();

/** A presentation as importing a PowerPoint file makes it: picture slides, with the file kept. */
function slideshow(): string {
  return s().createPresentation({
    title: 'Retreat',
    category: 'slideshows',
    background: { type: 'none', color: '#000000', color2: '#000000' },
    source: { kind: 'powerpoint', fileName: 'Retreat.pptx', fileId: 'file1', modelId: 'model1', width: 1920, height: 1080, importedAt: 1 },
    groups: [
      {
        id: 'g1',
        name: 'Slides',
        color: '#5f6368',
        slides: [
          { id: 's1', text: '', notes: 'Welcome everyone', source: { picture: 'pic1', text: 'WELCOME\n\nRetreat 2026', number: 1 } },
          { id: 's2', text: '', source: { picture: 'pic2', text: 'OBJECTIVES', number: 2 } },
        ],
      },
    ],
    arrangement: ['g1'],
  });
}

const slides = (id: string) => s().presentations[id].groups.flatMap((g) => g.slides);

beforeEach(() => {
  s().clearAll();
  useStore.setState({ media: [] });
});

describe('imported PowerPoint and Keynote presentations', () => {
  it('show each slide’s picture, with its words and notes on the stage', () => {
    const id = slideshow();
    s().select(id);
    s().goLive(id, 0);
    const frame = buildFrame(s());
    expect(frame.slide).toMatchObject({ text: '', picture: 'pic1' });
    expect(frame.stage).toMatchObject({ current: 'WELCOME\n\nRetreat 2026', next: 'OBJECTIVES', notes: 'Welcome everyone' });
    expect(frame.stage.currentSlide?.picture).toBe('pic1');
    expect(slideWords(slides(id)[1])).toBe('OBJECTIVES');
  });

  it('can’t have their slides changed, added, removed or restyled', () => {
    const id = slideshow();
    const before = structuredClone(s().presentations[id].groups);
    s().updateSlide(id, 's1', { text: 'Typed over', background: { type: 'color', color: '#fff', color2: '#fff' } });
    expect(s().addSlide(id, 's1')).toBeNull();
    expect(s().duplicateSlide(id, 's1')).toBeNull();
    s().deleteSlides(id, ['s2']);
    s().cutSlides(id, ['s1']);
    s().setPresentationText(id, 'New words');
    s().clearTextStyle(id, 'presentation');
    s().copySlides(id, ['s2']);
    expect(s().pasteSlides(id, 's1')).toBeNull();
    s().assignGroup(id, 's2', { name: 'Chorus', color: '#f00' });
    s().deleteGroup(id, 'g1');
    expect(s().presentations[id].groups).toEqual(before);
    // Cut still copied.
    expect(s().slideClipboard?.map((sl) => sl.id)).toEqual(['s2']);
  });

  it('can still be labelled, given transitions and renamed', () => {
    const id = slideshow();
    s().setSlideLabels(id, ['s1', 's2'], { name: 'Opening', color: '#e07b28' });
    s().setTransition(id, { slideId: 's2' }, { kind: 'cut', ms: 0 });
    s().updateGroup(id, 'g1', { name: 'Welcome', color: '#123456', slides: [] });
    s().updatePresentation(id, { title: 'Retreat 2026' });
    const p = s().presentations[id];
    expect(p.groups[0]).toMatchObject({ name: 'Welcome', color: '#123456' });
    expect(p.groups[0].slides.map((sl) => sl.label?.name)).toEqual(['Opening', 'Opening']);
    expect(p.groups[0].slides[1].transition).toEqual({ kind: 'cut', ms: 0 });
    expect(p.title).toBe('Retreat 2026');
  });

  it('don’t open in the editor', () => {
    const id = slideshow();
    s().select(id);
    s().openEditor('s1');
    expect(s().mode).toBe('show');
  });

  it('offer only showing, copying, labels, transitions and media on their slides', () => {
    const id = slideshow();
    s().select(id);
    const p = s().presentations[id];
    const labels = slideMenu(p, p.groups[0].slides[0], p.groups[0], { index: 0 })
      .filter((e) => e && e !== '-')
      .map((e) => (e as { label: string }).label);
    expect(labels).toEqual(['Show Slide', 'Copy', 'Label', 'Transition', 'Media']);
    s().setUI({ selectedSlideIds: ['s1'] });
    const on = enabledCommands({ kind: 'slides', presentation: p, ids: ['s1'] });
    expect([...on].filter((c) => ['cut', 'copy', 'paste', 'duplicate', 'delete'].includes(c))).toEqual(['copy']);
  });

  it('keep their pictures and files, which Lumen bundles carry with them', () => {
    const id = slideshow();
    const p = s().presentations[id];
    expect(isReadOnly(p)).toBe(true);
    expect(ownFiles(p).map((f) => f.id)).toEqual(['pic1', 'pic2', 'file1', 'model1']);
    const file = presentationFile(s(), id);
    expect(file.files?.map((f) => f.id)).toEqual(['pic1', 'pic2', 'file1', 'model1']);
    const blobs = new Map(['pic1', 'pic2', 'file1', 'model1'].map((k) => [k, new Uint8Array([1, 2, 3])]));
    const read = readLumenFile(zipFile(file, blobs));
    expect([...read.blobs.keys()].sort()).toEqual(['file1', 'model1', 'pic1', 'pic2']);
    // Into another library: the files come too, and it stays read-only.
    s().clearAll();
    const plan = planImport(s(), read.file, read.blobs, 'other');
    expect(plan.files.map((f) => f.id)).toEqual(['pic1', 'pic2', 'file1', 'model1']);
    expect(plan.presentations[0].source?.fileId).toBe('file1');
    expect(getSequence(plan.presentations[0]).map((e) => e.slide.source?.picture)).toEqual(['pic1', 'pic2']);
  });

  it('without their pictures (a file without them) become text slides of their words', () => {
    const id = slideshow();
    const p: Presentation = withoutMissingFiles(s().presentations[id], (f) => f === 'pic1');
    expect(p.groups[0].slides.map((sl) => [sl.text, sl.source?.picture])).toEqual([
      ['', 'pic1'],
      ['OBJECTIVES', undefined],
    ]);
    expect(p.source).toMatchObject({ kind: 'powerpoint' });
    expect(p.source?.fileId).toBeUndefined();
    const none = withoutMissingFiles(s().presentations[id], () => false);
    expect(none.source).toBeUndefined();
    expect(isReadOnly(none)).toBe(false);
  });
});
