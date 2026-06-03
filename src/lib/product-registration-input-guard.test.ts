import { describe, expect, it } from 'vitest';
import { analyzeUploadInputText } from './product-registration-input-guard';

describe('product registration upload input guard', () => {
  it('allows clean supplier product raw text', () => {
    const clean = [
      '상품명: 달랏 3박5일 패키지',
      '출발편: ZE981 18:55-22:25',
      '귀국편: ZE982 23:25-06:55',
      '판매가 성인 899,000원 / 아동 799,000원',
      '포함사항: 왕복항공권, 호텔, 일정표상 식사, 전용차량',
      '불포함사항: 개인경비, 매너팁, 선택관광',
      '최소 출발 인원 10명',
      '1일차 인천 출발 달랏 도착 호텔 체크인',
      '2일차 랑비앙산, 크레이지하우스 관광 후 석식',
      '3일차 다딴라 폭포, 죽림선원 관광',
    ].join('\n');

    const result = analyzeUploadInputText(clean);

    expect(result.blocked).toBe(false);
    expect(result.metrics.productAnchorScore).toBeGreaterThanOrEqual(5);
  });

  it('blocks customer/mobile page copies before parsing', () => {
    const pageCopy = [
      '홈 해외 패키지 테마 여행 매거진 단체 문의',
      '상품정보 요금표 일정표 선택관광 유의사항',
      '예약 문의하기 날짜 인원 선택 카카오 상담 최저가 후기',
      '날씨 현재 기온 Open-Meteo 고객 후기 첫 번째 후기',
      'A4 보기 모바일 LP 보기 블로그 카드뉴스 Studio AD',
    ].join('\n');

    const result = analyzeUploadInputText(pageCopy);

    expect(result.blocked).toBe(true);
    expect(result.issues.map(issue => issue.code)).toContain('web_page_copy');
  });

  it('blocks development prompts pasted into the upload box', () => {
    const prompt = [
      '/goal 상품등록 V3 모바일 랜딩 전수개선 계획',
      'PLEASE IMPLEMENT THIS PLAN',
      'Implementation Plan: src/app/api/upload/route.ts를 수정한다',
      'Test Plan: npm run type-check and vitest',
      'AGENTS.md CURRENT_STATUS.md CLAUDE.md를 읽고 진행한다',
    ].join('\n');

    const result = analyzeUploadInputText(prompt);

    expect(result.blocked).toBe(true);
    expect(result.issues.map(issue => issue.code)).toContain('non_product_prompt');
  });

  it('blocks mojibake and broken encoding text', () => {
    const broken = Array.from({ length: 12 }, () => (
      '遺?겼눣 ?멸씀?? 怨좏뭹寃??몄샃?? ?낅젰 ?띿뒪?? ?? ?? 占쏙옙 占쎈뮞'
    )).join('\n');

    const result = analyzeUploadInputText(broken);

    expect(result.blocked).toBe(true);
    expect(result.issues.map(issue => issue.code)).toContain('encoding_corrupted');
  });
});
