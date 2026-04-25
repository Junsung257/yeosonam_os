/**
 * 패키지 상태 / 감사 게이트 / 출발 지역 배지 SSOT
 * — 기존 src/app/admin/packages/page.tsx 인라인 매핑을 이관
 * — StatusBadge 컴포넌트가 import해서 소비
 */

export const PACKAGE_STATUS_BADGE: Record<string, string> = {
  pending:        'bg-status-warningBg text-status-warningFg',
  pending_review: 'bg-status-warningBg text-status-warningFg',
  approved:       'bg-status-successBg text-status-successFg',
  active:         'bg-status-successBg text-status-successFg',
  rejected:       'bg-status-dangerBg text-status-dangerFg',
  draft:          'bg-status-warningBg text-status-warningFg',
  archived:       'bg-status-neutralBg text-status-neutralFg',
};

export const PACKAGE_STATUS_LABEL: Record<string, string> = {
  pending:        '검토 대기',
  pending_review: '검토 대기',
  approved:       '판매 중',
  active:         '판매 중',
  rejected:       '거부됨',
  draft:          '검토 대기',
  archived:       '아카이브',
};

export const AUDIT_BADGE: Record<string, { cls: string; label: string; title: string }> = {
  clean:    { cls: 'bg-status-successBg text-status-successFg border border-emerald-200', label: '🟢 감사통과', title: 'E0~E4 모두 통과 — 즉시 승인 가능' },
  warnings: { cls: 'bg-status-warningBg text-status-warningFg border border-amber-200',   label: '🟡 경고',     title: '경고 있음 — 리포트 확인 후 force=true 로 승인' },
  blocked:  { cls: 'bg-status-dangerBg text-status-dangerFg border border-red-200',       label: '🔴 감사차단', title: '치명 에러 — 수정 후 post_register_audit.js 재실행 필요' },
};

export const REGION_BADGE: Record<string, string> = {
  '부산': 'bg-blue-50 text-blue-600 border-blue-100',
  '인천': 'bg-purple-50 text-purple-600 border-purple-100',
  '서울': 'bg-purple-50 text-purple-600 border-purple-100',
  '김포': 'bg-indigo-50 text-indigo-600 border-indigo-100',
  '대구': 'bg-orange-50 text-orange-600 border-orange-100',
  '청주': 'bg-teal-50 text-teal-600 border-teal-100',
  '광주': 'bg-green-50 text-green-600 border-green-100',
  '제주': 'bg-cyan-50 text-cyan-600 border-cyan-100',
};

export function regionBadgeClass(region?: string): string {
  if (!region) return '';
  for (const [key, cls] of Object.entries(REGION_BADGE)) {
    if (region.includes(key)) return cls;
  }
  return 'bg-status-neutralBg text-status-neutralFg border-slate-100';
}
