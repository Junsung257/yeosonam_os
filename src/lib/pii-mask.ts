/**
 * pii-mask.ts — 역할 기반 PII 동적 마스킹
 *
 * super_admin: 원본 그대로 반환
 * 그 외 (cs_agent, marketer, finance): 마스킹 처리
 *
 * 사용처:
 *   - /api/admin/customers/masked  — 고객 목록
 *   - 예약 상세 API (여권번호, 전화번호)
 */

export type AdminRole = 'super_admin' | 'cs_agent' | 'marketer' | 'finance';

/** super_admin만 PII 원본 열람 가능 */
export function canViewFullPii(role: string): boolean {
  return role === 'super_admin';
}

/**
 * 전화번호 마스킹
 * - super_admin: 원본
 * - 그 외: '010-****-****' 형식 (앞 3자리만 노출)
 *
 * 입력 예: '010-1234-5678' | '01012345678' | '010 1234 5678'
 */
export function maskPhone(phone: string | null, role: string): string | null {
  if (!phone) return null;
  if (canViewFullPii(role)) return phone;

  // 숫자만 추출
  const digits = phone.replace(/\D/g, '');

  // 010-XXXX-XXXX 계열 (11자리) 또는 지역번호 (10자리)
  if (digits.length === 11) {
    // 010-****-****
    return `${digits.slice(0, 3)}-****-****`;
  }
  if (digits.length === 10) {
    // 02-****-**** (지역번호 2자리) 또는 031-***-****
    const prefix = digits.startsWith('02') ? digits.slice(0, 2) : digits.slice(0, 3);
    return `${prefix}-****-****`;
  }

  // 기타 형식: 앞 3자 + 마스킹
  return `${digits.slice(0, 3)}-****-****`;
}

/**
 * 여권번호 마스킹
 * - super_admin: 원본
 * - 그 외: 첫 글자 + '*****' + 마지막 2자리
 *
 * 예: 'M12345678' → 'M*****78'
 */
export function maskPassport(passportNo: string | null, role: string): string | null {
  if (!passportNo) return null;
  if (canViewFullPii(role)) return passportNo;

  const s = passportNo.trim();
  if (s.length < 3) return '***';

  const first = s.slice(0, 1);
  const last = s.slice(-2);
  const stars = '*'.repeat(Math.max(s.length - 3, 3));
  return `${first}${stars}${last}`;
}

/**
 * 이메일 마스킹
 * - super_admin: 원본
 * - 그 외: 로컬 파트 앞 2자 + '***@' + 도메인
 *
 * 예: 'username@example.com' → 'us***@example.com'
 */
export function maskEmail(email: string | null, role: string): string | null {
  if (!email) return null;
  if (canViewFullPii(role)) return email;

  const atIdx = email.indexOf('@');
  if (atIdx < 0) return '***@***';

  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);

  const visibleLocal = local.length >= 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visibleLocal}***@${domain}`;
}
