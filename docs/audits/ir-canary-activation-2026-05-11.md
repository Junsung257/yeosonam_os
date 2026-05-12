# Phase 1.5 IR Canary 활성화 — 2026-05-11

**상태**: 환경 변수 기반 활성, 기본 1% 트래픽 라우팅
**관련 PR**: feature/card-news-v2 세션 4
**선행 메모리**: `project_phase_1_5_ir_layer.md` (2026-04-21 IMPLEMENTED)

---

## 1. 무엇이 바뀌었나

`/api/register-via-ir` 는 2026-04-21 부터 admin UI(`/admin/ir-preview`) 와 CLI(`db/register_via_ir.js`) 가
직접 호출하는 opt-in Canary 경로로 운영돼 왔다. 본 PR 은:

1. **`src/lib/ir-canary.ts` 신설** — Canary 활성 플래그 + 결정형 1% 샘플링 + 엔진 graceful degrade
2. **`/api/register-via-ir` 응답에 `canary` 블록 노출** — 상태(`enabled`, `rolloutPct`,
   `defaultEngine`, `anthropicAvailable`) 가 응답 JSON 에 포함되므로 외부 호출자가 현재 라우팅
   조건을 그대로 관찰 가능
3. **ANTHROPIC_API_KEY 부재 시 자동 강등** — `engine='claude'` 가 요청돼도
   `pickCanaryEngine()` 이 키 부재를 감지하면 `deepseek` 로 graceful degrade. 메모리 박제된
   "ANTHROPIC_API_KEY 갱신 필요" 블로커가 사라짐 (Anthropic 키 복구 전에도 IR 파이프 정상 동작)

## 2. 활성 조건 (env)

| 변수 | 기본값 | 효과 |
|------|--------|------|
| `IR_CANARY_ENABLED` | `false` | `true` 일 때만 `shouldSampleToIrCanary()` 가 라우팅 결정 반환 |
| `IR_CANARY_ROLLOUT_PCT` | `1` | 0~100. `shouldSampleToIrCanary(seed)` 가 `seed` 의 FNV-1a 해시 % 10000 으로 결정형 비교 |
| `IR_CANARY_DEFAULT_ENGINE` | `deepseek` | `deepseek`/`gemini`/`claude` 중 선택. claude 인데 키 없으면 자동 deepseek |

**Production 활성화 절차**:

1. `vercel env add IR_CANARY_ENABLED production` → 값 `true` 입력
2. `vercel env add IR_CANARY_ROLLOUT_PCT production` → 값 `1` (1% 로 시작)
3. 다음 배포 (또는 `vercel env pull && vercel deploy --prebuilt`) 후 즉시 반영
4. 24시간 모니터링:
   - `normalized_intakes` 행 증가율
   - `register-via-ir` 응답의 `engine` 분포
   - 게이트 미통과 (`step: 'validate-direct-ir'`, `'normalize'`) 비율
5. 안정 시 단계적 상향: 1 → 5 → 25 → 100

## 3. 라우팅 호출 패턴

자동 등록 호출자(어셈블러 어댑터, jarvis 등록 핸드오프)는 아래 패턴으로 사용:

```ts
import { shouldSampleToIrCanary } from '@/lib/ir-canary';
import crypto from 'crypto';

const seed = crypto.createHash('sha256').update(rawText).digest('hex');
if (shouldSampleToIrCanary(seed)) {
  await fetch('/api/register-via-ir', { method: 'POST', body: ... });
} else {
  // 기존 INSERT 경로
}
```

같은 `rawText` 는 항상 같은 결정을 반환 — 재시도/재실행이 라우팅을 흔들지 않는다.

## 4. ANTHROPIC_API_KEY 상태와 영향

- **2026-04-21 메모리**: "ANTHROPIC_API_KEY 401 — 사장님 갱신 필요" 블로커.
- **2026-05-11 현재**: DeepSeek V4-Pro 가 primary 이므로 Anthropic 키 부재가 IR 파이프 차단을 의미하지 않음.
- `engine='claude'` 명시 요청 시: `pickCanaryEngine()` 이 키 부재 감지 → deepseek 자동 사용 →
  응답에 `canary.anthropicAvailable: false` 로 노출.
- **권장**: Anthropic 키 복구는 Phase 2(DetailClient view.* 전환) 추진력 회복 시점에 함께 진행.
  Canary 활성에는 차단 사항 아님.

## 5. 검증 체크리스트 (활성 후)

- [ ] `vercel env ls production | grep IR_CANARY` — 3개 변수 모두 등록
- [ ] 임의 등록 1건 dry-run: `POST /api/register-via-ir { dryRun: true, ... }` →
      응답에 `canary.enabled: true`, `canary.rolloutPct: 1` 노출
- [ ] `normalized_intakes` 테이블에 `canary_mode=true` 행 출현
- [ ] `register-via-ir` 호출 후 `travel_packages.normalizer_version` 이
      `phase-1.5-deepseek` (또는 active engine) 으로 기록됨
- [ ] `db/error-registry.md` 의 PHASE-1.5-IR-intake@2026-04-21 항목에 활성일 추가
