# 상품등록 로컬 OCR 실행기 계약

상품등록 V6의 OCR 복구는 외부 유료 API를 기본값으로 사용하지 않습니다. `PRODUCT_REGISTRATION_V6_OCR_ENABLED=1`일 때도 기본 모드는 `PRODUCT_REGISTRATION_OCR_PROVIDER_MODE=local`이며, 로컬 실행기 두 개가 모두 설정되어야 합니다.

- PaddleOCR 실행기: 1차 관측. `PADDLEOCR_LOCAL_COMMAND`가 가리키는 실행 파일은 입력 파일 경로를 받아 JSON을 stdout으로 출력해야 합니다.
- Tesseract 실행기: 보조 관측. `TESSERACT_LOCAL_COMMAND`가 가리키는 실행 파일은 입력 파일 경로를 받아 일반 텍스트를 stdout으로 출력할 수 있습니다.
- 두 결과의 critical token(가격·날짜·항공편)이 다르면 자동 공개로 이어지지 않고 검수 대상으로 남습니다.
- OCR 결과는 원문 사실의 보조 증거일 뿐이며, HWP/HWPX의 native 표 구조와 상품축 결박이 우선입니다.

## 환경 변수

실행 파일 경로에는 공백이 포함되어도 됩니다. 실행은 shell을 거치지 않는 `execFile` 방식입니다.

```text
PRODUCT_REGISTRATION_V6_OCR_ENABLED=1
PRODUCT_REGISTRATION_OCR_PROVIDER_MODE=local

PADDLEOCR_LOCAL_COMMAND=C:\\tools\\yeosonam-ocr\\paddle-wrapper.exe
PADDLEOCR_LOCAL_ARGS_JSON=["--input","{input}"]
PADDLEOCR_LOCAL_VERSION=PP-StructureV3-<version>

TESSERACT_LOCAL_COMMAND=C:\\Program Files\\Tesseract-OCR\\tesseract.exe
TESSERACT_LOCAL_ARGS_JSON=["{input}","stdout","-l","kor+eng","--psm","6"]
TESSERACT_LOCAL_VERSION=5.x
```

`{input}`은 시스템이 임시 원문 파일 경로로 치환하는 유일한 입력 자리표시자입니다. 인자를 생략하면 입력 경로가 마지막 인자로 자동 추가됩니다. 인자는 JSON 배열이어야 하며 최대 32개, 각 인자는 최대 2,000자입니다.

## PaddleOCR stdout 형식

최소 형식은 다음과 같습니다. `text`는 10자 이상이어야 합니다.

```json
{
  "text": "전체 OCR 텍스트",
  "rawModelVersion": "PP-StructureV3-3.x",
  "pages": [
    {
      "page": 1,
      "text": "페이지 텍스트",
      "nodes": [{"text": "699,000원", "confidence": 0.99, "boundingBox": {"x": 10, "y": 20}}],
      "tables": [{
        "cells": [{"row": 0, "column": 1, "rowSpan": 1, "colSpan": 2, "text": "699,000원", "confidence": 0.99}]
      }]
    }
  ]
}
```

`pages`, `nodes`, `tables`, `cells`, `confidence`, `boundingBox`는 선택 사항입니다. 표 셀을 제공할 때 행·열 병합 정보는 native TableIR과 교차검증하는 데 사용됩니다. Paddle 실행기에 로그가 섞이는 경우 마지막 JSON object 한 줄도 허용되지만, 파싱 불가 출력은 격리됩니다.

## 운영 경계

- 이 저장소에는 PaddleOCR/Tesseract 바이너리나 무거운 Python 런타임을 포함하지 않습니다. 실행기는 별도 worker 또는 사내 래퍼로 설치하고 버전을 환경 변수에 고정해야 합니다.
- PDF를 직접 처리하지 못하는 OCR 실행기는 래퍼에서 페이지를 이미지로 rasterize한 뒤 OCR해야 합니다.
- CLOVA/Google 사용은 `PRODUCT_REGISTRATION_OCR_PROVIDER_MODE=cloud`를 명시한 경우에만 활성화됩니다. cloud 결과도 동일한 합의·계보 검증을 통과해야 하며 공개 권한이 아닙니다.
- 로컬 실행기 미설정, 실행 실패, 출력 형식 오류, provider 간 critical token 불일치는 자동 공개가 아니라 readiness 미충족 또는 사람 검수/시스템 격리로 끝납니다.
