export const PLATFORM_LABEL: Record<string, string> = {
  naver: '네이버',
  google: '구글',
  meta: '메타',
  kakao: '카카오',
};

export const STATUS_LABEL: Record<string, string> = {
  candidate: '후보',
  approved: '승인',
  testing: '테스트',
  active: '집행',
  winning: '성과 좋음',
  scaled: '확대',
  paused: '중지',
  negative: '제외',
  rejected: '반려',
  expired: '만료',
};

export function fmtWon(value: number | undefined): string {
  const v = Number(value || 0);
  if (v >= 10000) return `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

export function pct(value: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

export function queueTone(status: unknown): 'neutral' | 'good' | 'warn' | 'bad' {
  const value = String(status || '');
  if (['succeeded', 'uploaded', 'applied'].includes(value)) return 'good';
  if (['blocked', 'failed', 'rejected'].includes(value)) return 'bad';
  if (['approved', 'running', 'requested'].includes(value)) return 'warn';
  return 'neutral';
}

export function queueStatusLabel(status: unknown): string {
  const value = String(status || '');
  const labels: Record<string, string> = {
    approved: '승인',
    running: '실행 중',
    requested: '요청됨',
    succeeded: '성공',
    uploaded: '업로드됨',
    applied: '반영됨',
    blocked: '막힘',
    failed: '실패',
    rejected: '반려',
    pending: '대기',
    ready: '준비 완료',
  };
  return labels[value] || value || '-';
}

export function readinessTone(status: 'pass' | 'partial' | 'fail'): 'good' | 'warn' | 'bad' {
  if (status === 'pass') return 'good';
  if (status === 'partial') return 'warn';
  return 'bad';
}

export function auditTone(status: 'pass' | 'warn' | 'fail'): 'good' | 'warn' | 'bad' {
  if (status === 'pass') return 'good';
  if (status === 'warn') return 'warn';
  return 'bad';
}

export function inventoryTone(status?: 'operational' | 'partial' | 'blocked'): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'operational') return 'good';
  if (status === 'partial') return 'warn';
  if (status === 'blocked') return 'bad';
  return 'neutral';
}

export function actionTone(tone: 'good' | 'warn' | 'bad' | 'neutral'): 'good' | 'warn' | 'bad' | 'neutral' {
  return tone;
}
