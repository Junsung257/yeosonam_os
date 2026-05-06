interface Props {
  title?: string;
  items: string[];
}

/**
 * 블로그 글 상단에 배치되는 "핵심 요약" 박스.
 * GEO(Generative Engine Optimization) 연구에서 AI Overviews 인용률을 높이는 패턴.
 * bullet 3~5개를 넘기면 접힘 효과 대신 그냥 최대 6개로 자른다.
 */
export default function TldrBox({ title = '핵심 요약', items }: Props) {
  const clean = items.map((s) => s?.trim()).filter(Boolean).slice(0, 6);
  if (clean.length === 0) return null;

  return (
    <aside
      className="not-prose mb-10 rounded-2xl border border-blue-200 bg-gradient-to-br from-brand-light/70 to-blue-50/40 p-5 md:p-6"
      aria-label={title}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white"
        >
          !
        </span>
        <h2 className="text-sm font-bold tracking-tight text-text-primary">{title}</h2>
      </div>
      <ul className="space-y-2 text-[15px] leading-relaxed text-slate-700 md:text-[15.5px]">
        {clean.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
