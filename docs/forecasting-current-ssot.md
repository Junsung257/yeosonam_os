# 여소남 예측 현재 SSOT

> 상태: read-only lab · 검증일: 2026-09-02

## 결론

예측은 의사결정 참고 자료이며 자동 실행 권한이 아니다. `demand_forecast_v2`를 향후 shadow 결과 shape의 기준으로 사용하고, 기존 `demand_forecast`와 `demand_forecasts`는 호환 조회 전용으로 남긴다. 네 번째 예측 테이블은 만들지 않는다.

현재 production cron의 90일 `booking_pace_aggregate` 계산은 180일 일별 근거와 rolling backtest를 충족하지 못하므로 `data_insufficient`를 반환하고 어느 예측 테이블에도 쓰지 않는다. Python legacy pipeline도 `demand_forecasts` 계산 결과를 저장하지 않는다. 예측 결과는 광고비, 콘텐츠 생성·큐, charter 결정, 외부 발행을 실행할 수 없다.

## 데이터 계약

Forecast Lab 입력은 날짜별 다음 세 필드만 허용한다.

- `date`: 중복·누락 없는 `YYYY-MM-DD`
- `inquiries`: 비음수 일별 문의 수
- `bookings`: 비음수 일별 예약 수

이름, 전화, 이메일, 자유 문의, 고객·예약 ID, 메모와 같은 PII·준식별자는 입력 자체를 실패 처리한다. 전체 예측은 최소 180일 연속 데이터와 8개 rolling cutoff를 요구한다. 세그먼트는 해당 metric 값이 존재하는 서로 다른 날짜가 60일 이상일 때만 비교 대상이 된다.

## 기준선과 평가

`src/lib/forecast-lab.ts`는 같은 입력에 완전히 결정적인 다음 기준선을 계산한다.

- 7일·28일 seasonal naive
- 7일·28일 moving average
- 단순 exponential smoothing

각 모델은 동일한 8개 cutoff에서 WAPE, MAE, sMAPE를 계산한다. 실제 합계가 0이면 WAPE를 만들지 않고 `data_insufficient`로 남긴다. 새 모델은 반복 backtest에서 최고 seasonal naive보다 WAPE가 10% 이상 개선되고, 60일 기준을 통과한 중요 세그먼트를 하나도 악화시키지 않아야 `candidate`다. 통과해도 `advisory_only`이며 별도 승인 전 production mutation은 금지다.

`buildDemandForecastV2ShadowRows()`는 검증된 report를 기존 v2 shape로 변환할 뿐 DB에 쓰지 않는다. confidence를 임의 생성하지 않고, revenue와 confidence bounds는 `null`, charter는 `unknown`, metadata는 `shadow=true`, `downstream_mutations_allowed=false`다.

## Predictive Marketing 정비

`predictive-marketing`은 archive 점수에 난수를 섞어 가상 시계열을 만드는 fallback과 고정 `confidence=0.95`를 제거했다. 일별 키워드 데이터가 없거나 키워드별 28개 날짜가 없으면 `data_insufficient`를 반환한다. `autoQueueFromInsights()`는 호환 함수만 남기고 항상 `automation_disabled`와 queued 0을 반환한다.

## 외부 모델 라이선스

TimesFM-3 weight revision `900fcab43d1bfe71733a33b3fec61a41fce28a27`은 `timesfm-non-commercial-license-v1.0`이다. 라이선스가 상업 의사결정·production 사용을 금지하므로 다운로드, 통합, 결과의 상업 의사결정 사용을 모두 `license_blocked`로 둔다.

`google-research/timesfm` source와 2.5 이하 weight는 Apache-2.0 범위가 공지되어 있지만 자동 승인 대상이 아니다. 위 결정론적 기준선과 실제 180일 데이터가 준비된 뒤 고정 revision·weight license를 별도 검토한다.

## 검증

```bash
npm run check:forecast-lab
npx vitest run src/lib/forecast-lab.test.ts src/lib/predictive-marketing.safety.test.ts
npm run check:harness
```

정책 고정값과 외부 revision은 `config/forecast-lab-policy.json`이 권위다. 이번 단계에는 DB migration, live data export, model weight download, provider 변경이 없다.
