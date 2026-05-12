# Error Registry 회귀 테스트

`db/error-registry.md` 의 누적된 사고 케이스를 자동 회귀 테스트로 변환하는 인프라.
36건 텍스트만 남아 있던 것을 점진적으로 fixture 로 옮겨 매 PR마다 재발 자동 탐지.

## 디렉터리 구조

```
tests/regression/
  run.js                    # 모든 케이스 실행 + summary
  cases/
    ERR-special-notes-leak.test.js
    ERR-priceLabel-currency-prefix.test.js
    ...
  fixtures/                 # 케이스별 입력·기대값 JSON
    ERR-special-notes-leak.input.json
    ERR-special-notes-leak.expected.json
```

## 실행

```bash
npm run test:regression           # 모든 케이스 실행
node tests/regression/cases/<name>.test.js   # 단일 케이스
```

## 새 케이스 추가

1. error-registry.md 에 ERR-CODE 등록 후
2. `cases/<ERR-CODE>.test.js` 생성 — `node:test` API 사용
3. 입력·기대값이 길면 `fixtures/<ERR-CODE>.{input,expected}.json` 으로 분리
4. `run.js` 자동 발견 (cases/ 의 모든 .test.js)

## 컨벤션

- 한 케이스 = 한 파일 = 한 ERR 코드
- 케이스 이름은 ERR 코드와 일치 — 검색 가능
- assert 에 ERR 코드 포함 — 실패 메시지에서 어느 회귀인지 즉시 식별
- 외부 의존성 최소화 — DB 없이도 실행 가능 (pure 함수 단위 테스트)
