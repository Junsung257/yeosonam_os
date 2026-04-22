/**
 * 커버리지 갭 분석기
 *
 * 로직:
 *   1) 활성 상품(travel_packages.status in approved/active)의 destination 목록 추출
 *   2) 각 destination 마다 "있어야 할 정보성 글 체크리스트" 비교
 *   3) 누락된 조합 → blog_topic_queue 에 source='coverage_gap' 으로 주입
 *
 * 목표: 6개월 내 모든 목적지 × 표준 정보성 N종 풀커버리지.
 */

import { supabaseAdmin } from './supabase';

// 목적지별 "필수 정보성 블로그" 표준 체크리스트
// 각 항목은 여행 준비 funnel 의 구체적 질문에 1:1 대응
export const COVERAGE_CHECKLIST = [
  { slug_suffix: 'preparation',   topic_template: '{dest} 여행 준비물 완벽 체크리스트', category: 'preparation' },
  { slug_suffix: 'weather',       topic_template: '{dest} 월별 날씨와 옷차림 가이드',   category: 'local_info' },
  { slug_suffix: 'currency',      topic_template: '{dest} 화폐·환전·팁 문화 총정리',     category: 'local_info' },
  { slug_suffix: 'airport',       topic_template: '{dest} 공항에서 시내 이동 방법',       category: 'local_info' },
  { slug_suffix: 'visa',          topic_template: '{dest} 비자·입국 서류 필요 여부',     category: 'visa_info' },
  { slug_suffix: 'itinerary-3d',  topic_template: '{dest} 3박4일 추천 일정 예시',         category: 'itinerary' },
  { slug_suffix: 'itinerary-5d',  topic_template: '{dest} 4박5일 추천 일정 예시',         category: 'itinerary' },
  { slug_suffix: 'faq',           topic_template: '{dest} 여행 전 자주 묻는 질문 TOP 10', category: 'travel_tips' },
  { slug_suffix: 'budget',        topic_template: '{dest} 3박 4일 예상 총비용과 절약 팁', category: 'travel_tips' },
  { slug_suffix: 'transport',     topic_template: '{dest} 현지 교통수단 이용법',         category: 'local_info' },
];

export interface CoverageGap {
  destination: string;
  slug_suffix: string;
  topic: string;
  category: string;
  existing_slug?: string | null;  // 있으면 skip 표시 (디버깅용)
}

function toEnglishSlug(destKr: string): string {
  const map: Record<string, string> = {
    '다낭': 'danang', '나트랑': 'nhatrang', '방콕': 'bangkok', '타이베이': 'taipei',
    '도쿄': 'tokyo', '오사카': 'osaka', '후쿠오카': 'fukuoka', '삿포로': 'sapporo',
    '홍콩': 'hongkong', '마카오': 'macau', '싱가포르': 'singapore',
    '세부': 'cebu', '보라카이': 'boracay', '하노이': 'hanoi', '호찌민': 'hochiminh',
    '푸켓': 'phuket', '발리': 'bali', '코타키나발루': 'kotakinabalu',
    '장가계': 'zhangjiajie', '황산': 'huangshan', '서안': 'xian', '칭다오': 'qingdao',
    '하얼빈': 'harbin', '상하이': 'shanghai', '베이징': 'beijing', '광저우': 'guangzhou',
    '시안': 'xian', '후허하오터': 'hohhot',
  };
  const lower = destKr.toLowerCase();
  return map[destKr] || lower.replace(/[^a-z0-9]/g, '');
}

/**
 * 활성 상품의 destination 별로 누락된 정보성 블로그 조합을 찾는다.
 */
export async function analyzeCoverageGaps(opts?: { maxPerDestination?: number }): Promise<CoverageGap[]> {
  const maxPerDest = opts?.maxPerDestination ?? 3;

  // 1) 활성 상품의 고유 destination 추출
  const { data: packages, error: pkgErr } = await supabaseAdmin
    .from('travel_packages')
    .select('destination')
    .in('status', ['approved', 'active']);

  if (pkgErr) throw pkgErr;

  const destinations = Array.from(new Set(((packages || []) as Array<{ destination: string | null }>)
    .map((p) => p.destination as string | null)
    .filter((d): d is string => Boolean(d))));

  if (destinations.length === 0) return [];

  // 2) 각 destination 의 기존 정보성 블로그 slug 수집 (product_id IS NULL 만)
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('content_creatives')
    .select('slug')
    .eq('channel', 'naver_blog')
    .is('product_id', null)
    .in('status', ['published', 'scheduled', 'draft']);

  if (exErr) throw exErr;

  const existingSlugs = new Set(
    ((existing || []) as Array<{ slug: string | null }>)
      .map((e) => e.slug)
      .filter((s): s is string => Boolean(s))
  );

  // 3) 갭 계산
  const gaps: CoverageGap[] = [];

  for (const dest of destinations) {
    const destEn = toEnglishSlug(dest);
    let added = 0;
    for (const item of COVERAGE_CHECKLIST) {
      if (added >= maxPerDest) break;
      const expectedSlug = `${destEn}-${item.slug_suffix}`;

      // 유사 slug 존재 여부 (prefix 매칭)
      const alreadyExists = Array.from(existingSlugs).some(s => s === expectedSlug || s.startsWith(`${expectedSlug}-`));

      if (!alreadyExists) {
        gaps.push({
          destination: dest,
          slug_suffix: expectedSlug,
          topic: item.topic_template.replace('{dest}', dest),
          category: item.category,
        });
        added++;
      }
    }
  }

  return gaps;
}
