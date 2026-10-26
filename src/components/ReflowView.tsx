import { useEffect, useMemo, useRef, useState } from 'react';
import { getSequence, presentationToText } from '../lyrics';
import { useStore } from '../store';
import type { Presentation } from '../types';
import { EditOutline, Inspector, NoPresentation } from './EditView';

export function ReflowView() {
  const p = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined));
  if (!p) return <NoPresentation />;
  return (
    <>
      <EditOutline presentation={p} />
      <main className="reflow-center">
        <ReflowEditor key={p.id} presentation={p} />
      </main>
      <Inspector presentation={p} tabs={['presentation']} footer={<FormattingHelp />} />
    </>
  );
}

function ReflowEditor({ presentation: p }: { presentation: Presentation }) {
  const { setPresentationText } = useStore.getState();
  const [text, setText] = useState(() => presentationToText(p));
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(text);
  latest.current = text;
  const dirty = useRef(false);

  // Commit shortly after typing stops; flush on unmount so nothing is lost.
  useEffect(
    () => () => {
      clearTimeout(pending.current);
      if (dirty.current) setPresentationText(p.id, latest.current);
    },
    [p.id, setPresentationText],
  );

  const onChange = (value: string) => {
    setText(value);
    dirty.current = true;
    clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      setPresentationText(p.id, value);
      dirty.current = false;
    }, 300);
  };

  const slideCount = useMemo(() => getSequence(p).length, [p]);

  return (
    <div className="reflow">
      <div className="pres-bar">
        <span className="pres-title">{p.title}</span>
        <span className="pres-bar-spacer" />
        <span className="muted">
          {p.groups.length} groups · {slideCount} slides
        </span>
      </div>
      <textarea
        className="reflow-input"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck
        autoFocus={!text}
        placeholder={'[Verse 1]\nFirst line of the first slide\nSecond line\n\nNext slide…\n\n[Chorus]\n…'}
      />
    </div>
  );
}

function FormattingHelp() {
  return (
    <section className="insp-section help">
      <div className="insp-heading">Reflow formatting</div>
      <dl>
        <dt>[Chorus]</dt>
        <dd>Starts a group</dd>
        <dt>blank line</dt>
        <dd>Starts a new slide</dd>
        <dt>[Chorus] again</dt>
        <dd>With no lines under it, repeats the group in the arrangement</dd>
        <dt>~ text</dt>
        <dd>Caption under the slide, e.g. a verse reference</dd>
        <dt>&gt; text</dt>
        <dd>Note for the stage display only</dd>
      </dl>
      <p className="small-print muted">
        Per-slide layout and backgrounds made in Edit are kept when you reflow, as long as the group keeps its name.
      </p>
    </section>
  );
}
