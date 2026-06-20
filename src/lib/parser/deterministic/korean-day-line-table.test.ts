import { describe, expect, it } from 'vitest';

import { buildKoreanDayLineTableItinerary } from './korean-day-line-table';

describe('buildKoreanDayLineTableItinerary', () => {
  it('keeps inline first-day headers such as "1일 시코츠코" instead of starting at day 2', () => {
    const rawText = `
북해도 실속 갓성비알짜팩 3박4일
부산 07:00 부산 김해국제공항 국제선 집결
BX182 09:05 김해 국제공항 출발
치토세 11:40 신치토세 국제 공항 도착 및 입국 수속 중:현지식
1일 시코츠코 전용 시코츠코 이동
차량 ▶시코츠코 관광 석:호텔식
호텔 체크인 후 휴식, ♨온천욕
HOTEL : 조잔케이 뷰, 삿포로 가토킹덤 호텔 또는 동급
전용 호텔 조식 후
도야 차량 도야 이동
▶사이로 전망대, 쇼와신산, 도야호수 유람선 탑승 조:호텔식
노보리베츠 노보리베츠 이동
2일 ▶노보리베츠 지옥계곡 중:현지식
삿포로 삿포로 이동
▶오오도리 공원 석:자유식
3일
삿포로 삿포로 이동
▶북해도의 명물 시로이코이비토 파크(무료존)
4일 치토세 신치토세공항으로 이동 조:호텔식
BX181 12:40 신치토세 국제공항 출발
부산 15:30 김해 국제 공항 도착
`;

    const itinerary = buildKoreanDayLineTableItinerary(rawText);

    expect(itinerary?.days.map(day => day.day)).toEqual([1, 2, 3, 4]);
    expect(itinerary?.days[0]?.schedule.map(item => item.activity)).toContain('시코츠코 전용 시코츠코 이동');
  });

  it('recovers a split first day when PDF extraction tears 제1일 into table fragments', () => {
    const rawText = `
3/8 ,3/31 399,000원
왕복 항공료 및 텍스, 유류할증료, 호텔, 차량, 관광지입장료
자 역 일 정
부 산 07:30 김해 국제공항 미팅, 출국 수속
BX321 10:30 부산 출발
청 도 11:35 청도 도착, 중식 후
▶청도의 눈부신 바다앞 상징적인 건축물
잔교(차창관광)
따보도 문화거리
▶유럽감성거리를 청도에서!
천주교당
제1 신호산
중:산동요리
▶해발 110M에 위치해 청도 전체가 보이는
일 석:샤브샤브
찌모루시장
▶100년 청도 맥주의 역사를 볼 수 있는 맥주박물관 관광
호텔 투숙 및 휴식
청 도 전용버 호텔 조식 후
전 일
스 ▶매력적인 건축물로 "만국건축박물관"로 불리는 팔대관
제2
일 ▶청도의 핵심 도시 청양의 활발한 시장 청양 야시장
석:무제한
삼겹살
호텔 투숙 및 휴식
청 도 호텔 조식 후
제3 BX322 12:30 청도 출발 조:호텔식
일 부 산 15:30 부산 도착
`;

    const itinerary = buildKoreanDayLineTableItinerary(rawText);

    expect(itinerary?.days.map(day => day.day)).toEqual([1, 2, 3]);
    expect(itinerary?.days[0]?.schedule.some(item => item.activity.includes('김해 국제공항 미팅'))).toBe(true);
    expect(itinerary?.days[1]?.schedule.map(item => item.activity)).toContain('청도의 핵심 도시 청양의 활발한 시장 청양 야시장');
    expect(itinerary?.days[2]?.schedule.map(item => item.activity)).toContain('부 산 15:30 부산 도착');
  });
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

  it('bridges a missing itinerary day when OCR leaves only a numeric punctuation marker', () => {
    const rawText = `
1
BX429 10:35 출발
호텔 체크인
2
하노이 관광
사파 이동
3 * , , .
판시판 케이블카 관광
마사지 90분
4 :
Lotte Center Hanoi 65
BX428 00:30 출발
`;

    const itinerary = buildKoreanDayLineTableItinerary(rawText);

    expect(itinerary?.days.map(day => day.day)).toEqual([1, 2, 3, 4]);
    expect(itinerary?.days[2]?.schedule.some(item => item.activity.includes('판시판'))).toBe(true);
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
