import { describe, expect, it } from 'vitest';
import { parseDayTable } from './day-table';

// 청도 사고 (2026-05-15 ERR-KWL) 회귀 fixture — Phase 2 LLM 실패 시 deterministic 폴백 보장
const QINGDAO_3D5N = `
제1일
인 천

청 도



SC4610



12:15
13:05



 인천 국제공항 출발
 청도 국제공항 도착
 ▶청도의 눈부신 바다앞 상징적인 건축물 잔교(차창관광)
 ▶유럽감성거리를 청도에서! 따바오다오 먹자거리
 ▶1943년 완공된 높이56m의 아름다운 독일식 건축 성당
  천주교당 (외관)
 호텔 투숙 및 휴식
 󰆹 하이탠 엑스포 칭다오 호텔 또는 동급 (준5성)

제2일
청 도
전용차량
전 일
 호텔 조식 후
 ▶매력적인 건축물로 만국건축박물관으로 불리는 팔대관
 ▶청도의 랜드마크! 5.4운동을 기념하는 붉은 횃불 5.4광장 관광
 호텔 투숙 및 휴식
조:호텔식
중:현지식
석:무제한 삼겹살
 󰆹 하이탠 엑스포 칭다오 호텔 또는 동급 (준5성)

제3일
청 도
인 천
SC4619
19:30
21:55
호텔 조식 후
청도 출발
인천 도착
조:호텔식
`;

describe('parseDayTable (청도 회귀 fixture)', () => {
  it('제1일/제2일/제3일 행 인식', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    expect(r.days).toHaveLength(3);
    expect(r.days[0].day).toBe(1);
    expect(r.days[1].day).toBe(2);
    expect(r.days[2].day).toBe(3);
  });

  it('항공편 코드 SC4610/SC4619 추출 + 산동항공 prefix 매핑', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    expect(r.meta.flight_out).toBe('SC4610');
    expect(r.meta.flight_in).toBe('SC4619');
    expect(r.meta.airline).toBe('산동항공');
  });

  it('시간 추출 (12:15/13:05/19:30/21:55)', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    expect(r.meta.flight_out_time).toBe('12:15');
    expect(r.meta.flight_in_time).toBe('19:30');
  });

  it('regions 인식 (인천/청도)', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    expect(r.days[0].regions).toEqual(expect.arrayContaining(['인천', '청도']));
    expect(r.days[1].regions).toEqual(expect.arrayContaining(['청도']));
  });

  it('호텔 추출 (하이탠 엑스포 칭다오 호텔)', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    expect(r.days[0].hotel.name).toContain('칭다오');
    expect(r.days[0].hotel.grade).toBe('준5성');
  });

  it('식사 추출 (조/중/석)', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    expect(r.days[1].meals.breakfast).toBe('호텔식');
    expect(r.days[1].meals.lunch).toBe('현지식');
    expect(r.days[1].meals.dinner).toContain('삼겹살');
  });

  it('schedule 활동 추출 (▶ 마커)', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    const day1Activities = r.days[0].schedule.map(s => s.activity);
    expect(day1Activities.some(a => a.includes('잔교'))).toBe(true);
    expect(day1Activities.some(a => a.includes('천주교당'))).toBe(true);
  });

  it('confidence ≥ 0.6 (블록 + 호텔 + 식사 + 항공편 모두 채워짐)', () => {
    const r = parseDayTable(QINGDAO_3D5N);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('빈 입력 — confidence 0 + days []', () => {
    const r = parseDayTable('');
    expect(r.days).toHaveLength(0);
    expect(r.confidence).toBe(0);
  });

  it('표 형식 아닌 평문 — 행 인식 실패 시 빈 결과', () => {
    const r = parseDayTable('이것은 일반 텍스트로 일정표가 아닙니다.');
    expect(r.days).toHaveLength(0);
  });
});

// 보홀 슬림팩 DAY1 — 표 시간 컬럼(20:40/00:30)이 미팅 줄에 붙던 사고 (2026-05-22)
const BOHOL_DAY1 = `제1일

부 산
보 홀

7C2157

20:40
00:30


 출발2시간전 김해공항 국제선 1층에서 미팅 후 수속 
 부산 김해 국제공항 출발  
 보홀 팡라오 국제공항 도착
 가이드와 미팅하여 리조트로 이동 
 리조트 투숙 및 휴식 

HOTEL: 더스토리 리조트 (준4성급) 

제2일
보홀
`;

describe('parseDayTable (다낭 BX DAY1 항공 시간)', () => {
  const DANANG_DAY1 = `제1일

부 산
다 낭

BX773

20:50
23:50


 출발2시간전 김해공항 국제선 1층에서 미팅 후 수속 
 김해 국제공항 출발 (증편 BX7315 22:05-01:10)
 다낭 국제공항 도착
 호텔 투숙 및 휴식 

HOTEL: 센터포인트 다낭 또는 멜리아빈펄 호텔 또는 동급 (5성급)
`;

  it('미팅 줄 시간 없음, 김해 출발 20:50·다낭 도착 23:50', () => {
    const r = parseDayTable(DANANG_DAY1);
    const s = r.days[0].schedule;
    const meeting = s.find(x => x.activity.includes('미팅 후 수속'));
    const dep = s.find(x => /김해.*출발/.test(x.activity));
    const arr = s.find(x => /다낭.*도착/.test(x.activity));
    expect(meeting?.time).toBeUndefined();
    expect(dep).toMatchObject({ time: '20:50', type: 'flight', transport: 'BX773' });
    expect(arr).toMatchObject({ time: '23:50', type: 'flight', transport: 'BX773' });
    expect(r.meta.flight_out_time).toBe('20:50');
  });
});

describe('parseDayTable (보홀 슬림팩 DAY1 항공 시간)', () => {
  it('미팅·가이드 줄에는 시간 없음, 출발·도착만 20:40/00:30', () => {
    const r = parseDayTable(BOHOL_DAY1);
    const s = r.days[0].schedule;
    const meeting = s.find(x => x.activity.includes('미팅 후 수속'));
    const dep = s.find(x => x.activity.includes('부산 김해') && x.activity.includes('출발'));
    const arr = s.find(x => x.activity.includes('팡라오') && x.activity.includes('도착'));
    const guide = s.find(x => x.activity.includes('가이드와 미팅'));
    expect(meeting?.time).toBeUndefined();
    expect(guide?.time).toBeUndefined();
    expect(dep).toMatchObject({ time: '20:40', type: 'flight', transport: '7C2157' });
    expect(arr).toMatchObject({ time: '00:30', type: 'flight', transport: '7C2157' });
  });
});
