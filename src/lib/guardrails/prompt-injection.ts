const INJECTION_PATTERNS = [
  /이전\s*지시(를)?\s*무시/i,
  /시스템\s*프롬프트/i,
  /개발자\s*메시지/i,
  /권한\s*우회/i,
  /결제.*1원/i,
  /환불.*무조건/i,
  /ignore\s+previous\s+instructions/i,
  /reveal\s+system\s+prompt/i,
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

