import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

type PageProps = {
  params: Promise<{ id: string }>;
};

type QueryResult<T> = {
  data: T | null;
  error: string | null;
};

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  status: string | null;
  audit_status: string | null;
  publication_state?: string | null;
  package_revision?: number | null;
  updated_at: string | null;
  raw_text?: string | null;
  product_summary?: string | null;
  product_highlights?: unknown;
  optional_tours?: unknown;
  itinerary_data?: unknown;
  inclusions?: unknown;
  excludes?: unknown;
};

type SnapshotRow = {
  id: string;
  status: string | null;
  package_revision: number | null;
  snapshot_hash: string | null;
  source_evidence_digest: string | null;
  snapshot_json: Record<string, unknown> | null;
  card_projection: Record<string, unknown> | null;
  lp_projection: Record<string, unknown> | null;
  route_text_dump: unknown;
  created_at: string | null;
  published_at: string | null;
  revoked_at: string | null;
};

type DecisionRow = {
  publication_state: string | null;
  publishable: boolean | null;
  hard_blockers: unknown;
  soft_warnings: unknown;
  required_actions: unknown;
  public_snapshot_hash: string | null;
  created_at: string | null;
};

type QuarantineRow = {
  field_path: string | null;
  reason_code: string | null;
  resolution_status: string | null;
  old_value: unknown;
  created_at: string | null;
};

type ProofRow = {
  route: string | null;
  viewport_profile_version: string | null;
  locale: string | null;
  status: string | null;
  public_snapshot_hash: string | null;
  proof_input_hash: string | null;
  app_build_id: string | null;
  copy_template_version: string | null;
  created_at: string | null;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = '-') {
  const result = String(value ?? '').replace(/\s+/g, ' ').trim();
  return result || fallback;
}

function shortHash(value: unknown) {
  const raw = text(value, '');
  return raw ? `${raw.slice(0, 12)}...${raw.slice(-6)}` : '-';
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

function preview(value: unknown, limit = 220) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  const compact = raw.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact || '-';
}

function latest<T>(rows: T[] | null): T | null {
  return rows?.[0] ?? null;
}

async function safeQuery<T>(label: string, run: () => Promise<{ data: T | null; error: { message: string } | null }>): Promise<QueryResult<T>> {
  try {
    const { data, error } = await run();
    return { data: data ?? null, error: error?.message ?? null };
  } catch (error) {
    return { data: null, error: `${label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function StatusPill({ value, tone = 'neutral' }: { value: unknown; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const classes = {
    neutral: 'border-slate-200 bg-white text-slate-700',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    bad: 'border-red-200 bg-red-50 text-red-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
  };
  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${classes[tone]}`}>
      {text(value)}
    </span>
  );
}

function Section({
  title,
  children,
  error,
}: {
  title: string;
  children: React.ReactNode;
  error?: string | null;
}) {
  return (
    <section className="border-t border-slate-200 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {error ? <StatusPill value="조회 실패" tone="bad" /> : null}
      </div>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : children}
    </section>
  );
}

function DataCell({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-semibold text-slate-500">{label}</div>
      <div className="break-words text-sm text-slate-900">{text(value)}</div>
    </div>
  );
}

function FindingList({ value }: { value: unknown }) {
  const items = asArray(value);
  if (items.length === 0) return <p className="text-sm text-slate-500">없음</p>;
  return (
    <div className="space-y-2">
      {items.slice(0, 12).map((item, index) => {
        const record = asRecord(item);
        return (
          <div key={index} className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <div className="text-sm font-semibold text-slate-900">{text(record.code ?? record.fieldPath ?? `finding ${index + 1}`)}</div>
            <div className="mt-1 text-sm text-slate-600">{text(record.message ?? item)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default async function PublicPackageReviewPage({ params }: PageProps) {
  const resolvedParams = await params;
  const packageId = resolvedParams.id;

  if (!isSupabaseAdminConfigured) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-950">공개 경계 리뷰</h1>
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Supabase 관리자 연결이 없어 공개 스냅샷 검수 데이터를 불러올 수 없습니다.
        </p>
      </main>
    );
  }

  const packageResult = await safeQuery<PackageRow>('package', async () => await supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,status,audit_status,publication_state,package_revision,updated_at,raw_text,product_summary,product_highlights,optional_tours,itinerary_data,inclusions,excludes')
    .eq('id', packageId)
    .maybeSingle());

  if (!packageResult.error && !packageResult.data) notFound();

  const [snapshotsResult, decisionsResult, quarantineResult, proofsResult] = await Promise.all([
    safeQuery<SnapshotRow[]>('snapshots', async () => await supabaseAdmin
      .from('public_package_snapshots')
      .select('id,status,package_revision,snapshot_hash,source_evidence_digest,snapshot_json,card_projection,lp_projection,route_text_dump,created_at,published_at,revoked_at')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(5)),
    safeQuery<DecisionRow[]>('decisions', async () => await supabaseAdmin
      .from('package_publish_decisions')
      .select('publication_state,publishable,hard_blockers,soft_warnings,required_actions,public_snapshot_hash,created_at')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(10)),
    safeQuery<QuarantineRow[]>('quarantine', async () => await supabaseAdmin
      .from('quarantined_package_fields')
      .select('field_path,reason_code,resolution_status,old_value,created_at')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(20)),
    safeQuery<ProofRow[]>('proofs', async () => await supabaseAdmin
      .from('package_render_proofs')
      .select('route,viewport_profile_version,locale,status,public_snapshot_hash,proof_input_hash,app_build_id,copy_template_version,created_at')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(20)),
  ]);

  const pkg = packageResult.data;
  const snapshot = latest(snapshotsResult.data);
  const decision = latest(decisionsResult.data);
  const snapshotJson = asRecord(snapshot?.snapshot_json);
  const publicPackage = asRecord(snapshotJson.package);
  const ctaCopy = asRecord(snapshotJson.cta_copy);
  const activePollution = (quarantineResult.data ?? []).filter(row => row.resolution_status === 'active_unresolved');
  const staleProofRisk = !snapshot?.snapshot_hash
    ? []
    : (proofsResult.data ?? []).filter(row => row.status !== 'passed' || row.public_snapshot_hash !== snapshot.snapshot_hash);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Link className="text-sm font-semibold text-blue-700 hover:underline" href={`/admin/packages/${packageId}/review`}>
              기존 검수로 이동
            </Link>
            <Link className="text-sm font-semibold text-blue-700 hover:underline" href={`/packages/${packageId}`} target="_blank">
              고객 화면 열기
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-950">공개 경계 리뷰</h1>
          <p className="mt-2 text-sm text-slate-600">
            원문 DB 값, 공개 스냅샷, publish gate, route text dump, proof, quarantine을 한 화면에서 비교합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill value={pkg?.status ?? 'unknown'} tone={pkg?.status === 'active' ? 'good' : 'neutral'} />
          <StatusPill value={pkg?.publication_state ?? 'no publication_state'} tone={pkg?.publication_state === 'published' ? 'good' : decision?.publishable ? 'warn' : 'bad'} />
          <StatusPill value={decision?.publishable ? 'publishable' : 'not publishable'} tone={decision?.publishable ? 'good' : 'bad'} />
        </div>
      </div>

      <Section title="공개 판정 요약" error={packageResult.error}>
        <div className="grid gap-4 md:grid-cols-4">
          <DataCell label="상품명 원본" value={pkg?.title} />
          <DataCell label="여행지" value={pkg?.destination} />
          <DataCell label="package_revision" value={pkg?.package_revision} />
          <DataCell label="updated_at" value={formatDate(pkg?.updated_at)} />
          <DataCell label="audit_status" value={pkg?.audit_status} />
          <DataCell label="latest snapshot" value={snapshot?.status ?? '-'} />
          <DataCell label="snapshot_hash" value={shortHash(snapshot?.snapshot_hash)} />
          <DataCell label="latest decision" value={decision?.publication_state ?? '-'} />
        </div>
      </Section>

      <Section title="원문 DB 값 ↔ 공개 스냅샷 문구" error={snapshotsResult.error}>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-4">항목</th>
                <th className="py-2 pr-4">DB normalized/raw</th>
                <th className="py-2 pr-4">public snapshot</th>
                <th className="py-2 pr-4">route/card projection</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {[
                ['제목', pkg?.title, snapshotJson.public_title, snapshot?.card_projection?.title ?? snapshot?.lp_projection?.title],
                ['요약', pkg?.product_summary, publicPackage.product_summary, snapshot?.lp_projection?.summary],
                ['가격', publicPackage.price ?? '-', snapshotJson.price_display, snapshot?.card_projection?.price_display],
                ['기간', pkg?.package_revision ? `${snapshotJson.duration ?? '-'}일` : '-', snapshotJson.duration, snapshot?.card_projection?.duration],
                ['선택관광', pkg?.optional_tours, snapshotJson.optional_tours_public, asRecord(snapshotJson.option_policy).status],
                ['포함', pkg?.inclusions, snapshotJson.inclusions_public, '-'],
                ['불포함', pkg?.excludes, snapshotJson.exclusions_public, '-'],
                ['CTA', '-', text(ctaCopy.primary), text(ctaCopy.helper)],
              ].map(([label, dbValue, publicValue, projectionValue]) => (
                <tr key={String(label)} className="border-b border-slate-100">
                  <td className="w-36 py-3 pr-4 font-semibold text-slate-900">{String(label)}</td>
                  <td className="max-w-md py-3 pr-4 text-slate-700">{preview(dbValue)}</td>
                  <td className="max-w-md py-3 pr-4 text-slate-700">{preview(publicValue)}</td>
                  <td className="max-w-md py-3 pr-4 text-slate-700">{preview(projectionValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="차단 사유와 조치" error={decisionsResult.error}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Hard blockers</h3>
            <FindingList value={decision?.hard_blockers} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Warnings</h3>
            <FindingList value={decision?.soft_warnings} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Required actions</h3>
            <FindingList value={decision?.required_actions} />
          </div>
        </div>
      </Section>

      <Section title="숨겨졌지만 남은 오염 데이터" error={quarantineResult.error}>
        <div className="mb-3 flex gap-2">
          <StatusPill value={`active unresolved ${activePollution.length}`} tone={activePollution.length > 0 ? 'bad' : 'good'} />
          <StatusPill value={`total records ${(quarantineResult.data ?? []).length}`} />
        </div>
        <div className="space-y-2">
          {(quarantineResult.data ?? []).slice(0, 12).map((row, index) => (
            <div key={index} className="grid gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm md:grid-cols-5">
              <DataCell label="field" value={row.field_path} />
              <DataCell label="reason" value={row.reason_code} />
              <DataCell label="status" value={row.resolution_status} />
              <DataCell label="created" value={formatDate(row.created_at)} />
              <DataCell label="value" value={preview(row.old_value, 120)} />
            </div>
          ))}
          {(quarantineResult.data ?? []).length === 0 ? <p className="text-sm text-slate-500">격리 기록 없음</p> : null}
        </div>
      </Section>

      <Section title="Proof 최신성" error={proofsResult.error}>
        <div className="mb-3 flex gap-2">
          <StatusPill value={`stale/failed ${staleProofRisk.length}`} tone={staleProofRisk.length > 0 ? 'bad' : 'good'} />
          <StatusPill value={`proof rows ${(proofsResult.data ?? []).length}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-4">route</th>
                <th className="py-2 pr-4">viewport</th>
                <th className="py-2 pr-4">locale</th>
                <th className="py-2 pr-4">status</th>
                <th className="py-2 pr-4">snapshot</th>
                <th className="py-2 pr-4">proof input</th>
                <th className="py-2 pr-4">created</th>
              </tr>
            </thead>
            <tbody>
              {(proofsResult.data ?? []).map((row, index) => (
                <tr key={index} className="border-b border-slate-100">
                  <td className="py-2 pr-4">{text(row.route)}</td>
                  <td className="py-2 pr-4">{text(row.viewport_profile_version)}</td>
                  <td className="py-2 pr-4">{text(row.locale)}</td>
                  <td className="py-2 pr-4">{text(row.status)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{shortHash(row.public_snapshot_hash)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{shortHash(row.proof_input_hash)}</td>
                  <td className="py-2 pr-4">{formatDate(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(proofsResult.data ?? []).length === 0 ? <p className="py-3 text-sm text-slate-500">proof 기록 없음</p> : null}
        </div>
      </Section>

      <Section title="실제 route text dump" error={snapshotsResult.error}>
        <pre className="max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          {asArray(snapshot?.route_text_dump).map(item => text(item)).join('\n') || 'route_text_dump 없음'}
        </pre>
      </Section>

      <Section title="원문 근거 일부" error={packageResult.error}>
        <pre className="max-h-96 overflow-auto rounded-md border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-700">
          {text(pkg?.raw_text, 'raw_text 없음').slice(0, 8000)}
        </pre>
      </Section>
    </main>
  );
}
