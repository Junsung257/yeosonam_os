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

import { supabaseAdmin } from '@/lib/supabase';
import IrPreviewClient from './IrPreviewClient';

export const dynamic = 'force-dynamic';

async function loadDrafts() {
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
  return data || [];
}

export default async function IrPreviewPage() {
  const drafts = await loadDrafts();
  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">IR 미리보기 (Phase 1.5-C HITL)</h1>
        <p className="text-sm text-gray-500 mt-1">
          원문 → Normalizer 가 생성한 IR 을 승인/거절/재생성합니다. 승인 시 travel_packages 에 등록됩니다.
        </p>
        <div className="mt-2 text-xs text-gray-400">
          총 {drafts.length}건 ·
          draft {drafts.filter((d: any) => d.status === 'draft').length} /
          converted {drafts.filter((d: any) => d.status === 'converted').length} /
          failed {drafts.filter((d: any) => d.status === 'failed').length}
        </div>
      </div>

      <IrPreviewClient drafts={drafts} />
    </div>
  );
}
