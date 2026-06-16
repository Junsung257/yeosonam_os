/**
 * @file /admin/ir-preview — Phase 1.5-C HITL diff UI
 *
 * normalized_intakes 테이블의 IR draft 를 사장님이 1-click 검토·승인.
 *   - draft 상태 IR 리스트
 *   - 펼치면 IR JSON + pkg preview + rawText 3열 diff
 *   - [승인] → /api/register-via-ir 에 engine=direct + ir 전달하여 INSERT
 *   - [거절] → normalized_intakes.status='rejected'
 *   - [재생성] → LLM 재호출 (engine=claude|gemini 선택)
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import IrPreviewClient from './IrPreviewClient';
import { PageHeader } from '@/components/admin/patterns';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';

export const dynamic = 'force-dynamic';

async function loadDrafts() {
  if (!isSupabaseAdminConfigured) return [];

  const { data, error } = await supabaseAdmin
    .from('normalized_intakes')
    .select('id, raw_text, ir, land_operator, region, normalizer_version, status, canary_mode, judge_verdict, judge_report, created_at, updated_at')
    .in('status', ['draft', 'converted', 'failed'])
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[ir-preview] loadDrafts error', error);
    return [];
  }
  return (data || []).map((row: any) => {
    const ir = row.ir && typeof row.ir === 'object'
      ? { ...row.ir, rawText: safeRawTextExcerpt(row.ir.rawText, 2000) ?? '' }
      : row.ir;
    return {
      ...row,
      raw_text: safeRawTextExcerpt(row.raw_text, 2000) ?? '',
      ir,
    };
  });
}

export default async function IrPreviewPage() {
  const drafts = await loadDrafts();
  const draftCount = drafts.filter((d: any) => d.status === 'draft').length;
  const convertedCount = drafts.filter((d: any) => d.status === 'converted').length;
  const failedCount = drafts.filter((d: any) => d.status === 'failed').length;
  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="IR 미리보기 (Phase 1.5-C HITL)"
        subtitle="원문 → Normalizer 가 생성한 IR 을 승인/거절/재생성합니다. 승인 시 travel_packages 에 등록됩니다."
        badge={
          <span className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 bg-status-warningBg text-status-warningFg rounded-admin-xs text-admin-xs font-semibold admin-num">draft {draftCount}</span>
            <span className="px-2 py-0.5 bg-status-successBg text-status-successFg rounded-admin-xs text-admin-xs font-semibold admin-num">converted {convertedCount}</span>
            {failedCount > 0 && <span className="px-2 py-0.5 bg-status-dangerBg text-status-dangerFg rounded-admin-xs text-admin-xs font-semibold admin-num">failed {failedCount}</span>}
          </span>
        }
      />
      <IrPreviewClient drafts={drafts} />
    </div>
  );
}
