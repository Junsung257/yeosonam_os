import type { ReactNode } from 'react';

type SectionProps = { title: string; children: ReactNode; className?: string };

function ArchetypeSection({ title, children, className = '' }: SectionProps) {
  return (
    <section className={`my-8 rounded-2xl border border-slate-200 bg-white p-5 md:p-6 ${className}`}>
      <h2 className="mb-4 text-xl font-extrabold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

export function DecisionComparison({ title, children }: SectionProps) {
  return <ArchetypeSection title={title}><div className="overflow-x-auto" role="region" aria-label={`${title} 비교표`}>{children}</div></ArchetypeSection>;
}

export function RouteTimeline({ title, children }: SectionProps) {
  return <ArchetypeSection title={title}><ol className="space-y-4 border-l-2 border-brand/30 pl-5">{children}</ol></ArchetypeSection>;
}

export function BudgetScenarios({ title, children }: SectionProps) {
  return <ArchetypeSection title={title}><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div></ArchetypeSection>;
}

export function NeighborhoodSelector({ title, children }: SectionProps) {
  return <ArchetypeSection title={title}><div className="grid gap-4 md:grid-cols-2">{children}</div></ArchetypeSection>;
}

export function ChangeLog({ title, children }: SectionProps) {
  return <ArchetypeSection title={title} className="border-sky-200 bg-sky-50/50"><div className="space-y-3">{children}</div></ArchetypeSection>;
}

export function TravelerTypeCards({ title, children }: SectionProps) {
  return <ArchetypeSection title={title}><div className="grid gap-4 sm:grid-cols-2">{children}</div></ArchetypeSection>;
}

export function FieldNote({ title, children }: SectionProps) {
  return <ArchetypeSection title={title} className="border-emerald-200 bg-emerald-50/40"><div data-first-party-field-note>{children}</div></ArchetypeSection>;
}

export function SourceVerificationBox({ title = '근거 확인', children }: Partial<SectionProps> & { children: ReactNode }) {
  return <ArchetypeSection title={title}><div className="text-[0.95em] text-slate-700">{children}</div></ArchetypeSection>;
}

export function WarningBox({ title = '주의', children }: Partial<SectionProps> & { children: ReactNode }) {
  return <ArchetypeSection title={title} className="border-amber-300 bg-amber-50"><div role="alert">{children}</div></ArchetypeSection>;
}

export function PracticalChecklist({ title, children }: SectionProps) {
  return <ArchetypeSection title={title}><ul className="space-y-3 [&_a]:min-h-11 [&_button]:min-h-11">{children}</ul></ArchetypeSection>;
}
