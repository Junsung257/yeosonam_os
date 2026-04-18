# Visual + Text Regression Tests

## 개요

여소남 OS의 **A4 포스터 / 모바일 랜딩**이 렌더링 regression 없이 유지되는지 자동 검증.

## 2가지 테스트 방식

| 방식 | 도구 | 장점 | 단점 |
|------|------|------|------|
| **Visual (스크린샷)** | Playwright `toHaveScreenshot` | 레이아웃 붕괴 탐지 | 폰트/브라우저 차이에 민감 → `mask` 로 방어 |
| **Text Hash** | innerText + SHA-256 | 안정적, hydration 무관 | 시각 변경(색/폰트) 못 잡음 |

**두 방식을 병행**하여 서로의 약점 보완.

## 실행

```bash
# 최초 1회: 베이스라인 생성
UPDATE_BASELINE=1 npx playwright test tests/visual/ --update-snapshots

# 이후: 회귀 검증
npx playwright test tests/visual/

# 결과 리포트
npx playwright show-report
```

## 동적 데이터 마스킹

다음 selector는 자동으로 black-box 처리:
- `[data-dynamic="true"]`
- `[data-testid="current-date"]`
- `.timer`, `.relative-time`
- `[data-exchange-rate]`

새로운 동적 영역이 생기면 [helpers.ts](helpers.ts)의 `dynamicMasks()` 에 추가.

## 베이스라인 업데이트 시점

- 의도적 UI 변경 후: `UPDATE_BASELINE=1 npx playwright test tests/visual/ --update-snapshots`
- 실수로 regression 난 경우: **베이스라인 덮어쓰지 말고** 코드 원복

## 파일 구조

```
tests/visual/
├── README.md               (본 파일)
├── helpers.ts              (mask, textHash, waitForStable)
├── fixtures.json           (테스트 대상 상품 ID 목록)
├── packages.spec.ts        (상품 상세 페이지 회귀)
├── baselines/              (자동 생성 — git 커밋)
│   ├── kul-3d5-text.hash
│   └── kul-4d6-text.hash
└── packages.spec.ts-snapshots/  (자동 생성 — git 커밋)
    ├── kul-3d5-mobile-mobile-chrome.png
    └── ...
```

## 추가 상품 등록

[fixtures.json](fixtures.json)에 항목 추가 후 `UPDATE_BASELINE=1 npx playwright test` 한 번 실행.

## CI 통합

`.github/workflows/visual-regression.yml` 참조 (해당 파일은 추후 생성):
- main 브랜치 병합 전 필수 통과
- 실패 시 HTML 리포트 artifact 업로드
