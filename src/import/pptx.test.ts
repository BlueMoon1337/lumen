import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { DeckElement, DeckShape } from '../deck';
import { fontStack, parsePptx } from './pptx';
import { parseXml, path, attrOf } from './xml';

// ---- A small PowerPoint file, built here: one master, one layout, three slides ----

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (list: [id: string, type: string, target: string][]) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join('')}</Relationships>`;
const xfrm = (x: number, y: number, w: number, h: number, extra = '') =>
  `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
const sp = (name: string, body: string, ph = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>${body}</p:sp>`;
const tree = (shapes: string) =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;
const para = (text: string, pPr = '', rPr = '') => `<a:p>${pPr}<a:r><a:rPr lang="en" ${rPr}/><a:t>${text}</a:t></a:r></a:p>`;

// 10in × 5.625in (16:9): 9144000 × 5143500 EMU, so 1 px = 4762.5 EMU.
const W = 9144000;
const H = 5143500;
const px = (n: number) => Math.round(n * 4762.5);

const theme = `<a:theme ${NS} name="T"><a:themeElements><a:clrScheme name="C">
  <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
  <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
  <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
  <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
  <a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Arvo"/></a:majorFont><a:minorFont><a:latin typeface="Roboto"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

const master = `<p:sldMaster ${NS}>${tree(
  // A title placeholder (where titles go) and a band across the top on every slide.
  sp(
    'Title',
    `<p:spPr>${xfrm(px(100), px(60), px(1720), px(160))}</p:spPr><p:txBody><a:bodyPr anchor="b"/><a:p/></p:txBody>`,
    '<p:ph type="title"/>',
  ) +
    sp(
      'Band',
      `<p:spPr>${xfrm(0, 0, W, px(40))}<a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></p:spPr>`,
    ),
)}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const layout = `<p:sldLayout ${NS}>${tree(
  sp(
    'Body',
    `<p:spPr>${xfrm(px(100), px(300), px(1720), px(600))}</p:spPr><p:txBody><a:bodyPr/><a:p/></p:txBody>`,
    '<p:ph type="body" idx="1"/>',
  ),
)}</p:sldLayout>`;

const slide1 = `<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="102030"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${
  // The body first in the file, but lower on the slide than the title.
  sp(
    'Body',
    `<p:spPr/><p:txBody><a:bodyPr/>${para('First point')}${para('Second point', '<a:pPr><a:buFont typeface="Wingdings"/><a:buChar char="Ø"/></a:pPr>')}</p:txBody>`,
    '<p:ph type="body" idx="1"/>',
  ) +
  sp('Title', `<p:spPr/><p:txBody><a:bodyPr/>${para('Hello World')}</p:txBody>`, '<p:ph type="title"/>') +
  // A shape whose text color comes from its style (white), not the master's text styles.
  sp(
    'Badge',
    `<p:spPr>${xfrm(px(1800), px(1000), px(80), px(60))}<a:prstGeom prst="mathMinus"/><a:solidFill><a:srgbClr val="000A1E"/></a:solidFill></p:spPr><p:style><a:lnRef idx="0"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr anchor="ctr"/>${para('7')}</p:txBody>`,
  ) +
  // A group filled once for its shapes (grpFill), scaled from its own coordinates.
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(
    0,
    px(900),
    px(400),
    px(100),
  ).replace(
    '</a:xfrm>',
    '<a:chOff x="0" y="0"/><a:chExt cx="' + px(800) + '" cy="' + px(200) + '"/></a:xfrm>',
  )}<a:solidFill><a:srgbClr val="7A0000"/></a:solidFill></p:grpSpPr>${sp('In group', `<p:spPr>${xfrm(px(400), 0, px(400), px(200))}<a:prstGeom prst="rect"/><a:grpFill/></p:spPr>`)}</p:grpSp>`
}</p:spTree></p:cSld></p:sld>`;

const slide2 = `<p:sld ${NS} show="0">${tree(sp('Title', `<p:spPr/><p:txBody><a:bodyPr/>${para('Hidden')}</p:txBody>`, '<p:ph type="title"/>'))}</p:sld>`;
const slide3 = `<p:sld ${NS}>${tree(
  sp('Title', `<p:spPr/><p:txBody><a:bodyPr/>${para('Steps')}</p:txBody>`, '<p:ph type="title"/>') +
    sp(
      'List',
      `<p:spPr>${xfrm(px(100), px(300), px(800), px(400))}</p:spPr><p:txBody><a:bodyPr/>${['One', 'Two', 'Three']
        .map((t) => para(t, '<a:pPr marL="457200" indent="-457200"><a:buAutoNum type="arabicPeriod"/></a:pPr>'))
        .join('')}</p:txBody>`,
    ) +
    sp(
      'Number',
      `<p:spPr/><p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>3</a:t></a:fld></a:p></p:txBody>`,
      '<p:ph type="sldNum" idx="12"/>',
    ),
)}</p:sld>`;

const notes = `<p:notes ${NS}>${tree(
  sp('Notes', `<p:spPr/><p:txBody><a:bodyPr/>${para('Say hello first.')}</p:txBody>`, '<p:ph type="body" idx="1"/>'),
)}</p:notes>`;

const presentation = `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst>
<p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="${W}"/>
<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">
<p14:section name="Welcome" id="{A}"><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="257"/></p14:sldIdLst></p14:section>
<p14:section name="Teaching" id="{B}"><p14:sldIdLst><p14:sldId id="258"/></p14:sldIdLst></p14:section>
</p14:sectionLst></p:ext></p:extLst></p:presentation>`;

function samplePptx(): Uint8Array {
  const files: Record<string, string> = {
    'ppt/presentation.xml': presentation,
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'slide', 'slides/slide2.xml'],
      ['rId4', 'slide', 'slides/slide3.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml': master,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([['rId1', 'theme', '../theme/theme1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': layout,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/theme/theme1.xml': theme,
    'ppt/slides/slide1.xml': slide1,
    'ppt/slides/_rels/slide1.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'notesSlide', '../notesSlides/notesSlide1.xml'],
    ]),
    'ppt/slides/slide2.xml': slide2,
    'ppt/slides/_rels/slide2.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/slides/slide3.xml': slide3,
    'ppt/slides/_rels/slide3.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/notesSlides/notesSlide1.xml': notes,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

const shapes = (els: DeckElement[]): DeckShape[] =>
  els.flatMap((e) => (e.kind === 'group' ? shapes(e.children) : e.kind === 'shape' ? [e] : []));
const withText = (els: DeckElement[], text: string) =>
  shapes(els).find((e) => e.text?.paragraphs.some((p) => p.runs.some((r) => r.text === text)));

describe('PowerPoint files', () => {
  const deck = parsePptx(samplePptx());
  const [first, hidden, third] = deck.slides;

  it('reads every slide at 1920 wide, with its sections', () => {
    expect(deck).toMatchObject({ width: 1920, height: 1080 });
    expect(deck.slides).toHaveLength(3);
    expect(hidden.hidden).toBe(true);
    expect(deck.sections).toEqual([
      { name: 'Welcome', slides: [1, 2] },
      { name: 'Teaching', slides: [3] },
    ]);
  });

  it('gives each slide its words from the top down, and its speaker notes', () => {
    expect(first.text).toBe('Hello World\n\nFirst point\nSecond point\n\n7');
    expect(first.notes).toBe('Say hello first.');
    // The slide number isn't part of what a slide says.
    expect(third.text).toBe('Steps\n\nOne\nTwo\nThree');
  });

  it('puts placeholders where the layout and master do, styled by the master', () => {
    const title = withText(first.elements, 'Hello World')!;
    expect(title).toMatchObject({ x: 100, y: 60, w: 1720, h: 160 });
    expect(title.text).toMatchObject({ anchor: 'bottom' });
    const run = title.text!.paragraphs[0].runs[0];
    expect(run).toMatchObject({ bold: true, color: 'rgba(31, 41, 55, 1)', size: expect.closeTo(44 * (1920 / 720), 1) });
    expect(run.font).toContain('Arvo');
    expect(title.text!.paragraphs[0].align).toBe('center');
    const body = withText(first.elements, 'First point')!;
    expect(body).toMatchObject({ x: 100, y: 300, w: 1720, h: 600 });
    expect(body.text!.paragraphs[0].bullet?.text).toBe('•');
    // Wingdings' "Ø" is an arrowhead.
    expect(body.text!.paragraphs[1].bullet?.text).toBe('➢');
  });

  it('numbers automatic bullets', () => {
    const list = withText(third.elements, 'One')!;
    expect(list.text!.paragraphs.map((p) => p.bullet?.text)).toEqual(['1.', '2.', '3.']);
  });

  it('draws the master’s own shapes on the slide, with theme colors', () => {
    const band = shapes(first.elements).find((e) => e.fill?.kind === 'solid' && e.w === 1920 && e.h === 40);
    // accent1 (#4472C4) at half its lightness (HSL), as PowerPoint darkens.
    expect(band?.fill).toEqual({ kind: 'solid', color: 'rgba(32, 56, 100, 1)' });
    expect(first.background).toEqual({ kind: 'solid', color: 'rgba(16, 32, 48, 1)' });
    // Without a background of its own, a slide is white (the master has none either).
    expect(third.background).toEqual({ kind: 'solid', color: 'rgba(255, 255, 255, 1)' });
  });

  it('colors text by its shape’s style, and fills group shapes with the group’s fill', () => {
    const badge = withText(first.elements, '7')!;
    expect(badge.text!.paragraphs[0].runs[0].color).toBe('rgba(255, 255, 255, 1)');
    const group = first.elements.find((e) => e.kind === 'group')!;
    expect(group).toMatchObject({ x: 0, y: 900, w: 400, h: 100 });
    const inside = group.kind === 'group' ? group.children[0] : undefined;
    // Half the group's own coordinates across, so half its box.
    expect(inside).toMatchObject({ x: 200, y: 900, w: 200, h: 100, fill: { kind: 'solid', color: 'rgba(122, 0, 0, 1)' } });
  });

  it('says when a file isn’t PowerPoint', () => {
    expect(() => parsePptx(zipSync({ 'hello.txt': strToU8('hi') }))).toThrow(/isn’t a PowerPoint file/);
  });
});

describe('fonts', () => {
  it('fall back to look-alikes', () => {
    expect(fontStack('Calibri')).toMatch(/^"Calibri", /);
    expect(fontStack('Roboto Condensed').split(', ').length).toBeGreaterThan(2);
  });
});

describe('XML', () => {
  it('reads elements, attributes by local name, and decoded text', () => {
    const doc = parseXml(
      '<?xml version="1.0"?><a:p xmlns:a="x"><a:r><a:rPr b="1"/><a:t>Tom &amp; Jerry &gt; 2</a:t></a:r><!-- c --></a:p>',
    );
    expect(path(doc, 'r', 't')?.text).toBe('Tom & Jerry > 2');
    expect(attrOf(path(doc, 'r', 'rPr'), 'b')).toBe('1');
  });
});
