const INJECTION_PATTERNS = [
  /이전\s*지시(를)?\s*무시/i,
  /위\s*지시(를)?\s*무시/i,
  /시스템\s*프롬프트/i,
  /개발자\s*메시지/i,
  /숨겨진\s*(지시|규칙|프롬프트)/i,
  /권한\s*우회/i,
  /관리자\s*권한.*(부여|획득|전환)/i,
  /테넌트.*우회/i,
  /RLS.*(끄|해제|우회|무시)/i,
  /승인\s*없이.*(실행|처리|변경)/i,
  /도구.*강제\s*실행/i,
  /tool.*force/i,
  /결제.*1원/i,
  /환불.*무조건/i,
  /ignore\s+previous\s+instructions/i,
  /ignore\s+(all\s+)?(system|developer)\s+instructions/i,
  /reveal\s+system\s+prompt/i,
  /show\s+me\s+(your\s+)?(system|developer)\s+(prompt|message)/i,
  /bypass\s+(auth|authorization|permission|rls|tenant)/i,
  /run\s+tool\s+without\s+approval/i,
];

export function detectPromptInjection(message: string): {
  blocked: boolean;
  reason: string | null;
} {
  const hit = INJECTION_PATTERNS.find((re) => re.test(message));
  if (!hit) return { blocked: false, reason: null };
  return {
    blocked: true,
    reason: `의심 패턴 탐지: ${hit.toString()}`,
  };
}

