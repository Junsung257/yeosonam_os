/**
 * @file ir-canary.ts — Phase 1.5 IR (Intake Normalizer) Canary 활성 플래그 + 트래픽 라우팅
 *
 * Why:
 *   기존 /api/register-via-ir 는 admin UI · CLI(`db/register_via_ir.js`) 가 직접 호출하는
 *   opt-in 경로였다. v3 (2026-05-11) 부터는 env 플래그로 production 경로로 승격하면서
 *   자동 등록 워크플로(어셈블러 어댑터·jarvis 등록 핸드오프)가 일정 비율로 IR 파이프를 타도록
 *   라우팅 함수를 제공한다.
 *
 * 환경 변수:
 *   - IR_CANARY_ENABLED=true         → Canary 활성 (전체 토글)
 *   - IR_CANARY_ROLLOUT_PCT=1        → 트래픽 샘플 비율 (기본 1%, 0~100 정수/소수)
 *   - IR_CANARY_DEFAULT_ENGINE=...   → 'deepseek' (기본) | 'gemini' | 'claude'
 *
 * 호출 패턴:
 *   if (shouldSampleToIrCanary(rawTextHash)) {
 *     // /api/register-via-ir 로 라우팅
 *   } else {
 *     // 기존 /register 또는 어셈블러 직접 INSERT
 *   }
 *
 * ANTHROPIC_API_KEY 부재 시 graceful fallback:
 *   pickCanaryEngine('claude') 는 키 부재 감지 시 'deepseek' 로 강등 — 이미 deepseek 가
 *   `llm-gateway.ts` 의 primary 이므로 비용/품질 손실 없음.
 */

import { getSecret } from '@/lib/secret-registry';

export type IrCanaryEngine = 'deepseek' | 'gemini' | 'claude';

export interface IrCanaryStatus {
  enabled: boolean;
  rolloutPct: number;
  defaultEngine: IrCanaryEngine;
  anthropicAvailable: boolean;
}

export function isIrCanaryEnabled(): boolean {
  return process.env.IR_CANARY_ENABLED === 'true';
}

export function getIrCanaryRolloutPct(): number {
  const raw = process.env.IR_CANARY_ROLLOUT_PCT;
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(100, Math.max(0, n));
}

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic 1% sampling. `seed` 는 일반적으로 rawTextHash 또는 short_code —
 * 같은 입력은 항상 같은 결정이 나와 재호출/재시도가 라우팅 결과를 흔들지 않는다.
 */
export function shouldSampleToIrCanary(seed: string): boolean {
  if (!isIrCanaryEnabled()) return false;
  const pct = getIrCanaryRolloutPct();
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  const bucket = fnv1a(seed) % 10000;
  return bucket < Math.round(pct * 100);
}

/**
 * Claude 엔진 요청을 받았으나 ANTHROPIC_API_KEY 가 비어있으면 DeepSeek 로 강등.
 * 호출자가 engine 을 명시하지 않으면 IR_CANARY_DEFAULT_ENGINE 또는 'deepseek'.
 */
export function pickCanaryEngine(requested?: IrCanaryEngine | null): IrCanaryEngine {
  const fallback: IrCanaryEngine = (() => {
    const env = process.env.IR_CANARY_DEFAULT_ENGINE as IrCanaryEngine | undefined;
    if (env === 'gemini' || env === 'claude' || env === 'deepseek') return env;
    return 'deepseek';
  })();
  const target = requested || fallback;
  if (target === 'claude' && !getSecret('ANTHROPIC_API_KEY')) {
    // Claude 키 부재 — DeepSeek 로 graceful degrade.
    return 'deepseek';
  }
  return target;
}

export function getIrCanaryStatus(): IrCanaryStatus {
  return {
    enabled: isIrCanaryEnabled(),
    rolloutPct: getIrCanaryRolloutPct(),
    defaultEngine: pickCanaryEngine(),
    anthropicAvailable: !!getSecret('ANTHROPIC_API_KEY'),
  };
}
