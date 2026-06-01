import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import SensitiveRawText from '@/components/admin/SensitiveRawText';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type DraftRow = {
  id: string;
  package_id: string | null;
  raw_text: string;
  supplier_hint: string | null;
  document_type: string | null;
  structure_plan: Record<string, unknown> | null;
  ledger: { variants?: unknown[] } | null;
  match_summary: Record<string, unknown> | null;
  gate_result: { status?: string; customer_publishable?: boolean; checks?: unknown[] } | null;
  status: string;
  created_at: string;
};

async function loadDrafts(): Promise<DraftRow[]> {
  const { data, error } = await supabaseAdmin
    .from('product_registration_drafts')
    .select('id, package_id, raw_text, supplier_hint, document_type, structure_plan, ledger, match_summary, gate_result, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[product-registration-drafts] load failed', error);
    return [];
  }
  return (data ?? []).map((row: DraftRow) => ({
    ...row,
    raw_text: safeRawTextExcerpt(row.raw_text, 1200) ?? '',
  }));
}

function statusClass(status: string) {
  if (status === 'ready_to_publish') return 'bg-status-successBg text-status-successFg';
  if (status === 'blocked') return 'bg-status-dangerBg text-status-dangerFg';
  if (status === 'needs_review') return 'bg-status-warningBg text-status-warningFg';
  return 'bg-admin-surface-2 text-admin-muted';
}

export default async function ProductRegistrationDraftsPage() {
  const drafts = await loadDrafts();
  const ready = drafts.filter(d => d.status === 'ready_to_publish').length;
  const review = drafts.filter(d => d.status === 'needs_review').length;
  const blocked = drafts.filter(d => d.status === 'blocked').length;

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="상품등록 V3 Draft Ledger"
        subtitle="업로드 원문에서 생성한 source index, ledger, matcher, gate 결과를 고객 노출 전에 검토합니다."
        badge={
          <span className="flex gap-1.5">
            <span className="px-2 py-0.5 rounded-admin-xs bg-status-successBg text-status-successFg text-admin-xs font-semibold">ready {ready}</span>
            <span className="px-2 py-0.5 rounded-admin-xs bg-status-warningBg text-status-warningFg text-admin-xs font-semibold">review {review}</span>
            <span className="px-2 py-0.5 rounded-admin-xs bg-status-dangerBg text-status-dangerFg text-admin-xs font-semibold">blocked {blocked}</span>
          </span>
        }
      />

      {drafts.length === 0 ? (
        <section className="border border-admin-border bg-admin-surface p-5">
          <h2 className="text-admin-base font-semibold text-admin-text">아직 생성된 V3 draft가 없습니다.</h2>
          <p className="mt-1 text-admin-sm text-admin-muted">
            상품 업로드 후 `product_registration_drafts` sidecar 저장이 성공하면 이 화면에 표시됩니다.
          </p>
          <Link href="/admin/upload" className="mt-3 inline-flex text-admin-sm font-semibold text-admin-accent hover:underline">
            업로드 화면으로 이동
          </Link>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-3">
        {drafts.map((draft) => {
          const checks = Array.isArray(draft.gate_result?.checks) ? draft.gate_result?.checks ?? [] : [];
          const failed = checks.filter((check) => {
            const row = check as { status?: string };
            return row.status === 'fail';
          });
          const unmatched = Number(draft.match_summary?.attraction_unmatched_count ?? 0);
          const optionReview = Number(draft.match_summary?.option_review_count ?? 0);
          return (
            <article key={draft.id} className="border border-admin-border bg-admin-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-admin-xs text-admin-xs font-semibold ${statusClass(draft.status)}`}>
                      {draft.status}
                    </span>
                    <h2 className="text-admin-base font-semibold text-admin-text">
                      {draft.document_type ?? 'unknown'} · {draft.supplier_hint ?? 'supplier unknown'}
                    </h2>
                  </div>
                  <p className="mt-1 text-admin-xs text-admin-muted">
                    {draft.package_id ? `package ${draft.package_id}` : 'no package link'} · {new Date(draft.created_at).toLocaleString('ko-KR')}
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-3 text-right text-admin-xs">
                  <div>
                    <div className="text-admin-muted">variants</div>
                    <div className="font-semibold admin-num">{draft.ledger?.variants?.length ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-admin-muted">unmatched</div>
                    <div className="font-semibold admin-num">{unmatched}</div>
                  </div>
                  <div>
                    <div className="text-admin-muted">options</div>
                    <div className="font-semibold admin-num">{optionReview}</div>
                  </div>
                  <div>
                    <div className="text-admin-muted">failed</div>
                    <div className="font-semibold admin-num">{failed.length}</div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-admin-xs">
                {unmatched > 0 ? (
                  <Link href="/admin/attractions/unmatched" className="font-semibold text-admin-accent hover:underline">
                    미매칭 관광지 검수 큐 열기
                  </Link>
                ) : null}
                {draft.package_id ? (
                  <Link href={`/admin/packages/${draft.package_id}/review`} className="font-semibold text-admin-accent hover:underline">
                    연결 상품 검수
                  </Link>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1">
                  <SensitiveRawText value={draft.raw_text} title="원문 발췌" />
                </div>
                <div className="min-w-0">
                  <div className="text-admin-xs font-semibold text-admin-text mb-2">Gate</div>
                  <pre className="text-[11px] leading-tight whitespace-pre-wrap text-admin-text-2 bg-admin-surface-2 p-3 overflow-auto">
                    {JSON.stringify(draft.gate_result, null, 2)}
                  </pre>
                </div>
                <div className="min-w-0">
                  <div className="text-admin-xs font-semibold text-admin-text mb-2">Plan</div>
                  <pre className="text-[11px] leading-tight whitespace-pre-wrap text-admin-text-2 bg-admin-surface-2 p-3 overflow-auto">
                    {JSON.stringify(draft.structure_plan, null, 2)}
                  </pre>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
