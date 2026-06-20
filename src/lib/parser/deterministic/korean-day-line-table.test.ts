import { describe, expect, it } from 'vitest';

import { buildKoreanDayLineTableItinerary } from './korean-day-line-table';

describe('buildKoreanDayLineTableItinerary', () => {
  it('recovers PDF/OCR reversed Korean day markers such as 일1/일2/일3', () => {
    const rawText = `
북해도 알짜 BA 2박 3일
일자지 역교통편시 간주 요 일 정식 사
일1
부산
치토세
BX182
06:50
08:50
부산 김해국제공항 국제선 집결
김해 국제공항 출발
신치토세 국제공항 도착 및 입국 수속
▶오타루운하 키타이치가라스 오르골당 자율관광
중현지식:
석호텔식:
아사히카와 아트 호텔 또는 동급 HOTEL :
일2
아사히카와
비에이
전용차량호텔 조식 후
▶패치워크 로드 차창관광
▶흰수염폭포 청의 호수 켄과 메리 나무
조호텔식:
중현지식:
석현지식:
일3
삿포로
치토세
부산
BX181 12:30
15:25
호텔 조식 후
신치토세 국제 공항 출발
김해 국제 공항 도착
조호텔식:
포함사항
왕복항공료 호텔 식사
`;

    const itinerary = buildKoreanDayLineTableItinerary(rawText);

    expect(itinerary?.days.map(day => day.day)).toEqual([1, 2, 3]);
    expect(itinerary?.days[0]?.schedule.some(item => item.activity.includes('오타루운하'))).toBe(true);
    expect(itinerary?.days[1]?.schedule.some(item => item.activity.includes('흰수염폭포'))).toBe(true);
    expect(itinerary?.days[2]?.schedule.some(item => item.activity.includes('김해 국제 공항 도착'))).toBe(true);
  });

  it('keeps inline 제N일차 markers and spaced 제 일N markers as customer schedule days', () => {
    const rawText = `
치앙마이 노팁노옵션 4박6일
제1일차 부산
김해 국제공항 출발
호텔 CHECK-IN 및 휴식
제2일차 치앙라이 전용차량 전일
▶백색사원 왓롱쿤
▶골든트라이앵글 관광
제 일3치앙마이
▶도이수텝 사원
제 일4 치앙마이
▶왓체디루앙, 타페게이트 관광
제5일차 치앙마이
공항으로 이동
제6일차 부산
부산 김해 공항 도착
`;

    const itinerary = buildKoreanDayLineTableItinerary(rawText);

    expect(itinerary?.days.map(day => day.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(itinerary?.days[1]?.schedule.some(item => item.activity.includes('백색사원'))).toBe(true);
    expect(itinerary?.days[2]?.schedule.some(item => item.activity.includes('도이수텝'))).toBe(true);
  });
});
