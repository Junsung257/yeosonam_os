import { describe, expect, it } from 'vitest';

import { createTextDocumentIR } from '@/lib/product-registration-v4/document-ir';
import { classifyProductSourceDocument, classifyProductSourceFilename } from './document-classifier';

function textIr(text: string) {
  return createTextDocumentIR({
    filename: 'supplier.txt',
    sourceType: 'text',
    text,
    parserEngine: 'test',
    parserVersion: '1',
  });
}

function namedTextIr(filename: string, text: string) {
  return createTextDocumentIR({ filename, sourceType: 'text', text, parserEngine: 'test', parserVersion: '1' });
}

describe('classifyProductSourceDocument', () => {
  it('accepts a travel product source with commercial and itinerary anchors', () => {
    const classification = classifyProductSourceDocument({
      sourceType: 'text',
      documentIr: textIr(`다낭 3박5일 패키지\n성인 상품가 899,000원\n포함 사항: 왕복 항공, 호텔, 조식\n불포함 사항: 가이드팁\nDAY 1 인천공항 출발 VN431\nDAY 2 관광 및 리조트 숙박`),
    });
    expect(classification.documentClass).toBe('travel_product');
  });

  it('uses document facts even when the original filename contains a broken byte', () => {
    const filename = '★다낭 노옵션 패키지 - 컴10\u0080521).hwp';
    const classification = classifyProductSourceDocument({
      sourceType: 'hwp',
      documentIr: namedTextIr(filename, `다낭 3박5일 패키지\n성인 상품가 899,000원\n포함 사항: 왕복 항공, 호텔\n불포함 사항: 개인경비\nDAY 1 부산공항 출발 BX321\nDAY 2 관광 및 호텔 숙박`),
    });
    expect(classification.documentClass).toBe('travel_product');
    expect(classification.reasonCode).toBe('TRAVEL_PRODUCT_DOCUMENT');
  });

  it('terminates a development instruction as non travel', () => {
    const classification = classifyProductSourceDocument({
      sourceType: 'text',
      documentIr: textIr(`PLEASE IMPLEMENT THIS PLAN\nAGENTS.md를 읽고 개발 작업 계획을 구현한다.\n완료조건과 테스트 계획을 작성한다.`),
    });
    expect(classification).toMatchObject({
      documentClass: 'non_travel',
      reasonCode: 'NOT_TRAVEL_PRODUCT_DOCUMENT',
    });
  });

  it('does not register institutional travel procurement or academic forms as products', () => {
    const procurement = classifyProductSourceDocument({
      sourceType: 'hwp',
      documentIr: namedTextIr('2026 해외체험학습 위탁용역 과업지시서.hwp', [
        '해외체험학습 위탁용역 과업지시서', '항공 및 호텔 숙박', '3박5일 일정',
        '제안 가격 1,200,000원', '포함 사항 및 취소 규정',
      ].join('\n')),
    });
    const thesis = classifyProductSourceDocument({
      sourceType: 'hwp',
      documentIr: namedTextIr('부산교육대학교 학위논문 작성 서식 가이드.hwp', [
        '학위 논문 작성 서식 가이드', '관광 연구', '가격 500,000원',
        '호텔 및 공항 사례', '포함 사항과 불포함 사항 작성 예시',
      ].join('\n')),
    });
    expect(procurement.documentClass).toBe('non_travel');
    expect(thesis.documentClass).toBe('non_travel');
    expect(classifyProductSourceFilename({
      sourceType: 'hwp',
      filename: '\uBC1C\uBA85 \uC544\uC774\uB514\uC5B4 \uC124\uBA85\uC11C_\uD559\uC0DD.hwp',
    })?.documentClass).toBe('non_travel');
  });

  it('treats a passenger confirmation as an operational document, not a sellable product', () => {
    const classification = classifyProductSourceDocument({
      sourceType: 'hwp',
      documentIr: namedTextIr('(확정서) 0603 서안5일.hwp', [
        '서안 3박5일 여행 확정서', '예약자 홍길동', '확정 인원 4명',
        '상품가 899,000원', '포함 항공 호텔', '불포함 개인경비', 'DAY 1 공항 출발',
      ].join('\n')),
    });
    expect(classification.documentClass).toBe('non_travel');
  });

  it('does not count an itinerary confirmation with passenger operations but no selling price as a product', () => {
    const classification = classifyProductSourceDocument({
      sourceType: 'hwp',
      documentIr: namedTextIr('(\uD655\uC815\uC11C) 260601 \uC7A5\uAC00\uACC4 4\uC77C.hwp', [
        '\u3010\uD655\uC815\uC11C\u3011 \uC7A5\uAC00\uACC4 4\uBC155\uC77C',
        '\uCD1D 4\uBD84',
        '\uCC28\uB7C9 \uC885\uB958 9\uC778\uC2B9 \uCC28\uB7C9',
        '\uAC1D\uC2E4 \uC885\uB958 2\uC778\uC2E4',
        '\uBBF8\uD305\uC7A5\uC18C \uAE40\uD574\uACF5\uD56D',
        '\uBBF8\uD305 \uB2F4\uB2F9\uC790 010-1234-5678',
        '\uD604\uC9C0 \uAC00\uC774\uB4DC \uD64D\uAE38\uB3D9',
        '\uD3EC\uD568 \uD56D\uACF5\uB8CC, \uD638\uD154, \uC2DD\uC0AC',
        '\uBD88\uD3EC\uD568 \uAC1C\uC778\uACBD\uBE44',
        'DAY 1 BX371 \uBD80\uC0B0 \uCD9C\uBC1C',
      ].join('\n')),
    });
    expect(classification).toMatchObject({
      documentClass: 'non_travel',
      reasonCode: 'NOT_TRAVEL_PRODUCT_DOCUMENT',
    });
    expect(classification.evidence).toContain('non-product:operational-booking-document');
  });

  it('keeps PDF and OCR cohorts outside the initial 95 percent denominator', () => {
    expect(classifyProductSourceDocument({ sourceType: 'pdf' })).toMatchObject({
      documentClass: 'unsupported',
      reasonCode: 'UNSUPPORTED_DOCUMENT_COHORT',
    });
  });

  it('marks unusable extraction text corrupt', () => {
    expect(classifyProductSourceDocument({ sourceType: 'hwp', documentIr: textIr('짧음') })).toMatchObject({
      documentClass: 'corrupt',
      reasonCode: 'CORRUPT_SOURCE_DOCUMENT',
    });
  });
});
