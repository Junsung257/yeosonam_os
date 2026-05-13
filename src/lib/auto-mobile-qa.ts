/**
 * @file auto-mobile-qa.ts
 * @description 등록 직후 모바일 페이지를 fetch → HTML 검증 → ai_quality_log 적재.
 *
 * 박제 사유 (2026-05-13): 푸꾸옥 등록 사고에서 V2 confidence 0.905 라 보고됐지만
 * 모바일 페이지에 노출된 결함(투어비 9%, notices 빈 화면)이 실제로는 78%.
 * → 실제 렌더 결과를 자동 점검해서 V2 산식과의 gap 을 잡아야 함.
 *
 * 동작:
 *   1. ISR revalidate 호출 (페이지 캐시 무효화)
 *   2. 페이지 fetch (HTML)
 *   3. 정규식 검사: leak 패턴 + 누락 검사
 *   4. ai_quality_log.failed_checks 에 추가 누락 적재
 *
 * fail-soft: 모든 단계 catch → 로깅만, 등록 자체엔 영향 없음.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { LEAK_PATTERNS } from '@/lib/customer-leak-sanitizer';

interface QAIncident {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  message: string;
}

export async function runAutoMobileQA(packageId: string, baseUrl?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const url = baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com';

  try {
    // 1) ISR revalidate
    const secret = process.env.REVALIDATE_SECRET;
    if (secret) {
      void fetch(`${url}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [`/packages/${packageId}`], secret }),
      }).catch(() => {});
    }

    // ISR 빌드 대기
    await new Promise(r => setTimeout(r, 3000));

    // 2) 페이지 fetch
    const pageUrl = `${url}/packages/${packageId}`;
    const res = await fetch(pageUrl, { headers: { 'User-Agent': 'YeosonamAutoQA/1.0' } });
    if (!res.ok) {
      console.warn(`[AutoQA] ${packageId}: fetch fail ${res.status}`);
      return;
    }
    const html = await res.text();

    // 3) 검증
    const incidents: QAIncident[] = [];

    // leak 패턴 (sanitizer set 재사용)
    for (const rule of LEAK_PATTERNS) {
      const match = html.match(rule.pattern);
      if (match && match.length > 0) {
        incidents.push({
          id: `mobile_leak_${rule.id}`,
          severity: rule.severity,
          message: `모바일 HTML 에 leak 노출 (${rule.description}): "${match[0]}"`,
        });
      }
    }

    // notices 섹션 비어있는지
    const hasNoticesSection = /유의사항|중요\s*공지|결제\s*조건|현장\s*규정/.test(html);
    const bulletCount = (html.match(/[•▶]\s/g) ?? []).length;
    if (hasNoticesSection && bulletCount < 3) {
      incidents.push({
        id: 'mobile_notices_empty',
        severity: 'high',
        message: `유의사항 섹션 비어 보임 (불렛 ${bulletCount}개)`,
      });
    }

    // 항공편 카드 존재 여부
    if (!/가는편|오는편/.test(html)) {
      incidents.push({
        id: 'mobile_flight_card_missing',
        severity: 'high',
        message: '항공편 카드 (가는편/오는편) 누락',
      });
    }

    // 4) ai_quality_log 적재
    if (incidents.length > 0) {
      const { data: latestLog } = await supabaseAdmin
        .from('ai_quality_log')
        .select('id, failed_checks')
        .eq('package_id', packageId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestLog?.id) {
        const existing = Array.isArray((latestLog as { failed_checks?: unknown[] }).failed_checks)
          ? ((latestLog as { failed_checks: unknown[] }).failed_checks)
          : [];
        const merged = [
          ...existing,
          ...incidents.map(i => ({ id: i.id, severity: i.severity, passed: false, message: i.message })),
        ];
        await supabaseAdmin
          .from('ai_quality_log')
          .update({ failed_checks: merged })
          .eq('id', latestLog.id);
      }
      console.warn(`[AutoQA] ${packageId}: ${incidents.length} mobile incident(s)`);
    } else {
      console.log(`[AutoQA] ${packageId}: mobile clean ✓`);
    }
  } catch (e) {
    console.warn('[AutoQA] 실패(무시):', (e as Error).message);
  }
}
