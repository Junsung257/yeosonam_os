# travel_packages 필드 의미 사전 (Content Policy)

> **목적**: 각 필드에 어떤 내용이 들어가야 하는지 명시. ERR-FUK-customer-leaks 재발 방지.
> **원칙**: 구조(Zod)가 아닌 **의미(Semantic)** 검증 규칙.

---

## 🔐 Agent Office Shadow Run 필드

`agent_runs`는 신규 실행 시도에 대한 비권위 관측 원장이다. `agent_tasks`의 업무 상태, `agent_trace_spans`의 기존 관측 증거, 승인·Command 원장을 대체하지 않는다.

| 필드 | 의미 | 허용 | 금지 |
|---|---|---|---|
| `input_hash`, `output_hash`, `input_schema_hash` | 내용·스키마 무결성 식별자 | `sha256:<64 hex>` | 원문, URL, 파일 경로 |
| `actor_id`, `actor_session_id` | 내부 불투명 감사 식별자 | 서비스/세션 ID | 이름, 이메일, 전화번호 등 PII |
| `lease_token_hash` | 고엔트로피 Lease Secret의 SHA-256 | DB 내부 비교만 | 원문 토큰 저장·RPC 반환 |
| `policy_snapshot` | 서버가 만든 비콘텐츠 정책 메타데이터 | 위험도·권한 금지·실행 모드 | Prompt, Tool Arguments, 모델 응답, 고객정보, Secret, Signed URL |
| `budget_snapshot`, `max_*` | 계약 시점의 수치형 실행 한도 | 시간·Turn·Tool·Token·비용 | 자유 텍스트, 업무 내용 |
| `output_artifact_ref` | 별도 원장을 가리키는 불투명 참조 | 내부 Artifact ID | 공개 URL, 로컬 경로, 결과 원문 |
| `trace_id` | 기존 Trace와의 관측 연결 | 불투명 Trace ID | Trace 원문 복제 |
| `authoritative`, `command_access_allowed`, `production_access` | 권위 경계 | 항상 `false` | 승격 또는 우회 |

직접 테이블 권한은 `service_role`에도 부여하지 않는다. 생성·Lease·Heartbeat·상태 전이·완료는 제한된 RPC만 사용하며, Lease 이후 변경에는 Secret과 Fencing Token이 모두 필요하다. 과거 실행 Backfill과 추정 Run 생성은 금지한다.

---

## 🔐 블로그 오토파읿 V4 운영 필드

블로그 생성·검수·색인 원장은 모두 고객 미노출 `service_role` 전용이다. 원본 공급자 응답은 덮어쓰지 않고, 파생 판정만 추가한다.

| 테이블/필드 | 의미 | 허용 | 금지 |
|---|---|---|---|
| `blog_generation_runs.pipeline_version` | 파이프라인 계약 버전 | 고정 버전 ID | 사용자 입력 |
| `blog_generation_runs.deployment_commit_sha` | 실행 배포 SHA | Vercel/Git SHA | 프롬프트·토큰 |
| `blog_generation_runs.schema_migration_version` | 요구 DB 버전 | migration timestamp | 임의 라벨 |
| `indexing_reports.provider_raw_response` | 검색 공급자 원본 결과 | 비밀값 제거 JSON | 수정·삭제·자격증명 |
| `search_lifecycle_status` | 파생 생명주기 | queued→ranking 중 한 단계 | 제출 성공을 indexed로 기록 |
| `provider_receipt_status` | 제출 수신 결과 | unknown/pending/accepted/rejected/not_applicable | 색인 여부 대체 |
| `blog_indexing_classification_revisions` | append-only 정정 원장 | 추가·조회 | update/delete |
| `blog_search_followup_jobs` | D+1/3/7 유한 추적 | 상태·재시도·원본 증거 | 7일 후 무한 재제출 |
| `blog_search_correction_queue` | D+7 기술/콘텐츠 보정 | 유한 검토 상태 | 자동 프롬프트 변경 |

---

## 🔒 고객 노출 필드 (Customer-Facing)

**절대 내부 운영 메모 넣지 말 것.** A4 포스터 / 모바일 랜딩에 그대로 노출됨.

| 필드 | 용도 | 허용 | 금지 |
|------|------|------|------|
| `title` | 상품명 | 마케팅 제목 | 내부 코드, "랜드사 ...", 해시태그 |
| `display_title` | 표시용 제목 (title 대체) | 클렌징된 제목 | 동일 |
| `product_summary` | 한줄 설명 (모바일 상단) | 고객 어필 문구 | 커미션, 정산 정보 |
| `product_highlights` | 핵심 특전 배지 | 상위 4개 어필 포인트 | "노팁/노옵션" 단독 |
| `inclusions` | 포함 사항 | 항목 배열 | 숫자 콤마 split 잔해 ("2\|000엔") |
| `excludes` | 불포함 사항 | 항목 배열 | surcharges와 중복, 숫자 split |
| `notices_parsed` | 유의사항 (4-type 구조화) | CRITICAL/PAYMENT/POLICY/INFO | 커미션 관련 |
| `itinerary_data.highlights.shopping` | 쇼핑 안내 | "노옵션 & 노쇼핑" / "3회" 등 | 내부 메모 |

**위반 감지**: `validatePackage` W21, W22, W23 경고

---

## 🔐 내부 필드 (Internal-Only)

고객에게 노출되지 않음. 운영/정산/검색용.

| 필드 | 용도 | 허용 |
|------|------|------|
| `land_operator_id` | 랜드사 UUID | 참조값만 |
| `commission_rate` | 커미션 % | number 0~100 |
| `short_code` | 내부 상품코드 | `<SUPPLIER>-<DEST>-<DAYS>-<NN>` |
| `internal_code` | ERP 연동 코드 | 자유 |
| `raw_text` | 원문 (감사용) | 전체 원문 |
| `filename` | 소스 파일명 | 자유 |
| `confidence` | AI 파싱 신뢰도 | 0~1 |

---

## ⚠️ 경계 필드 (Conditional)

## 🆕 2026-04-27 — `special_notes` deprecation + customer/internal 분리

| 필드 | 노출 | 용도 |
|------|------|------|
| `customer_notes` | 🟢 고객 OK | 고객 노출 자유 텍스트. CRC `resolveShopping` fallback 출처. W21 키워드 검증. |
| `internal_notes` | 🔒 운영 전용 | 커미션·정산·랜드사 협의·운영 메모. 어떤 텍스트도 OK. 어드민에서만 표시. |
| `special_notes` | ⚠️ DEPRECATED | LLM 컨텍스트(card-news, content-brief 등)·어드민 호환용. **고객 fallback 경로 모두 제거됨.** 신규 등록은 customer/internal 사용. |

**커미션이 10만원 고정 같은 특수 케이스** (P1 #5, 2026-04-27 적용):
- ✅ `commission_fixed_amount` (정액 KRW/USD/JPY/CNY) + `commission_currency` 사용
- 정액 모드일 때 `commission_rate = 0` 자동 설정 (상호배타)
- `internal_notes` 에는 운영 메모만 — 정액 정보는 컬럼에 명시
- ❌ `customer_notes` 에 마진 정보 절대 금지 (W21 차단)

**랜드부산 정액 마진 적용 사례**:
- LB-FUK-03-01/02 → 100,000원/건 정액
- LB-TAO-03-01, 04-01 → 90,000원/건 정액

**createInserter 사용**:
```js
const inserter = createInserter({
  landOperator: '랜드부산',
  commissionFixedAmount: 90000,  // 정액 (commissionRate 무시됨)
  commissionCurrency: 'KRW',
  ticketingDeadline: '2026-04-29',
  destCode: 'TAO',
});
// 또는 % 마진:
const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 9,             // %
  ticketingDeadline: '2026-04-15',
  destCode: 'NHA',
});
```

---

## 📋 필수 검증 규칙 (validatePackage)

| 코드 | 검사 | 심각도 |
|------|------|--------|
| W21 | special_notes에 내부 키워드 포함 | ❌ error (INSERT 차단) |
| W22 | 고객 필드에 내부 키워드 포함 | ❌ error |
| W23 | 숫자 split 잔해 (excludes/inclusions) | ❌ error |
| W24 | surcharges ↔ excludes 중복 | ⚠️ warning |
| W25 | flight activity 파싱 불가 포맷 | ⚠️ warning |

---

## 🗺️ A4 템플릿 Fallback Rules (주의)

A4 포스터 렌더 시 필드가 없으면 다음 순서로 fallback — **이 fallback 경로가 노출 위험의 근원**.

```
쇼핑센터 섹션:
  itinerary_data.highlights.shopping  ← 1순위
  ↓ (없으면)
  special_notes                        ← 2순위 (❗ 내부 메모 노출 원인)
```

**정책**: `itinerary_data.highlights.shopping` 을 **항상 명시적으로 설정**. null이어도 명시. special_notes에는 고객용 텍스트만.

---

## 📝 insert 스크립트 작성 시 체크리스트

- [ ] `special_notes` 에 "커미션", "정산", "LAND_OPERATOR", "commission_rate" 키워드 없는가?
- [ ] `itinerary_data.highlights.shopping` 명시했는가?
- [ ] `excludes` 항목 중 "2,000엔" 처럼 숫자 콤마 있는 항목 → `flattenItems`의 숫자 콤마 보호 테스트 통과했는가?
- [ ] `surcharges` 객체 배열이 있으면 `excludes` 문자열에 같은 정보 중복되지 않았는가?
- [ ] flight activity 가 "X 출발 → Y 도착 HH:MM" 또는 "X 출발 → Y HH:MM 도착" 포맷인가?
