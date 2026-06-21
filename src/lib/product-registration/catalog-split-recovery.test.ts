import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSupplierRawDeterministicItinerary, extractSupplierRawDeterministicFacts } from '@/lib/supplier-raw-deterministic-facts';
import { recoverCatalogSplitFromRawText } from './catalog-split-recovery';
import { recoverUploadPriceData } from './price-recovery';

describe('recoverCatalogSplitFromRawText', () => {
  it('splits repeated SPECIAL PRICE supplier blocks into separate products', () => {
    const raw = `♥ SPECIAL PRICE ♥
부산 - 푸꾸옥 세이브 여유로운 6일

7/11 4박6일 선착순 4명 1인 599,000원

최소출발인원
 성인4명이상
포 함 내 역
 왕복 항공료 및 텍스, 유류할증료, 호텔(2인1실), 일정상의 차량 & 식사
선택관광
 △ 혼똠섬 케이블카 &워터파크 $60/인
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부 산
푸꾸옥
ZE981
18:55
22:25
 부산 김해공항 출발
 푸꾸옥 국제공항 도착 후 호텔 체크인 및 휴식
제6일
부 산
06:55
 부산 국제공항 도착

♥ SPECIAL PRICE ♥
부산 - 푸꾸옥 스탠다드 완전정복 6일

7/11 4박6일 선착순 4명 1인 799,000원

최소출발인원
 성인4명이상
포 함 내 역
 왕복 항공료 및 텍스, 유류할증료, 호텔(2인1실), 일정상의 차량 & 식사
선택관광
 키스 오브 더 씨 쇼 포함
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부 산
푸꾸옥
ZE981
18:55
21:30
 부산 김해공항 출발
 푸꾸옥 국제공항 도착 후 호텔 체크인 및 휴식
제6일
부 산
06:55
 부산 국제공항 도착`;

    const products = recoverCatalogSplitFromRawText(raw);

    expect(products).toHaveLength(2);
    expect(products[0]?.extractedData.title).toBe('부산 - 푸꾸옥 세이브 여유로운 6일');
    expect(products[1]?.extractedData.title).toBe('부산 - 푸꾸옥 스탠다드 완전정복 6일');
    expect(products[0]?.extractedData.duration).toBe(6);
    expect(products[0]?.extractedData.nights).toBe(4);
    expect(products[0]?.sectionRawText).toContain('599,000원');
    expect(products[0]?.sectionRawText).not.toContain('799,000원');
    expect(products[1]?.sectionRawText).toContain('799,000원');
  });

  it('recovers newline PKG catalog sections before upload route blocks customer delivery', () => {
    const raw = `공통 가격표
스팟특가
6/20,21,28
999,-
1,159,-

PKG
클락 알뜰 3색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)

PKG
클락 알뜰 3색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일
2026.4.1
출 발 일
6/1~10/24 (수,목)

PKG
클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일
2026.4.1
출 발 일
6/1~10/24 (토,일)`;

    const products = recoverCatalogSplitFromRawText(raw);

    expect(products).toHaveLength(4);
    expect(products.map(product => product.extractedData.title)).toEqual([
      '클락 알뜰 3색골프 + 단독차량 3박5일',
      '클락 알뜰 3색골프 + 단독차량 4박6일',
      '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 3박5일',
      '클락 품격 풀빌라 더비스타 2색골프 + 단독차량 4박6일',
    ]);
    expect(products.every(product => product.sectionRawText?.includes('공통 가격표'))).toBe(true);
    expect(products[0].extractedData.destination).toBe('클락');
    expect(products[0].extractedData.duration).toBe(5);
    expect(products[1].extractedData.duration).toBe(6);
  });

  it('splits repeated bracketed day-only supplier schedules into separate products', () => {
    const raw = `항공스케줄
2026년 4월 3일 ~ 5월 30일 [ 매주 화, 금 출발 ]
화(3박5일) / 금(4박6일)
부산-계림 LJ779 22:05 - 01:05+1
계림-부산 LJ780 02:05 - 06:40
출 발 일
4/7, 14, 21
1,229,000

[ 노옵션+노팁 ] 계림/침주 고의령 & 망산 5일 - LJ
출 발 일 자
26년 4월 3일 ~ 5월 30일 (화요일 출발)
상 품 가
요금표 참조
날 짜
지 역
교통편
시 간
세 부 사 항
식 사
제1일
부 산
계 림
LJ779
22:05
01:05
부산 김해국제공항 출발
제2일
계 림
호텔 조식 후 고의령 관광
제3일
침 주
망산 풍경구 관광
제4일
망 산
계림으로 이동 후 양강사호 유람선
제5일
계 림
부 산
LJ780
02:05
06:40
계림 국제공항 출발

[ 노옵션+노팁 ] 계림/침주 고의령 & 망산 6일 - LJ
출 발 일 자
26년 4월 3일 ~ 5월 30일 (금요일 출발)
상 품 가
요금표 참조
날 짜
지 역
교통편
시 간
세 부 사 항
식 사
제1일
부 산
계 림
LJ779
22:05
01:05
부산 김해국제공항 출발
제2일
계 림
호텔 조식 후 고의령 관광
제3일
침 주
망산 풍경구 관광
제4일
망 산
계림 이동
제5일
계 림
자유시간
제6일
계 림
부 산
LJ780
02:05
06:40
계림 국제공항 출발`;

    const products = recoverCatalogSplitFromRawText(raw);

    expect(products).toHaveLength(2);
    expect(products.map(product => product.extractedData.duration)).toEqual([5, 6]);
    expect(products[0]?.sectionRawText).toContain('화(3박5일)');
    expect(products[1]?.sectionRawText).toContain('화(3박5일)');
    expect(products[0]?.sectionRawText).not.toContain('망산 6일');
    expect(products[1]?.sectionRawText).toContain('망산 6일');
  });

  it('does not split a single PDF itinerary into title and body pseudo-products', () => {
    const raw = `치앙마이+치앙라이 노팁노옵션 4박6일
출 발 일 4/26 - 5/1 (4박6일) 여행 인원 최소출발 인원 6명 이상
판 매 가 659,000원
일 자 지 역 항공편 시 간 일 정 식 사
김해 국제공항 집결 후 출국 수속
부 산 16:00
김해 국제공항 출발
ZE917 18:55
태국 치앙마이 국제공항 도착 후 가이드 미팅
치앙마이 22:10 석:불포함
제1일차 호텔 CHECK - IN 및 휴식
호텔 조식 후 치앙라이로 이동
제2일차 치앙라이 전용차량 전 일
치앙마이로 복귀
제3일차 치앙마이 전용차량 전 일
도이수텝 사원 관광
제4일차 치앙마이 전용차량 전 일
쌈깜팽 민예마을 관광
제5일차 치앙마이 전용차량 전 일
공항으로 이동
제6일차 ZE918 06:05 부산 김해 공항 도착`;

    expect(recoverCatalogSplitFromRawText(raw)).toHaveLength(0);
  });

  it('splits Xian/Huashan BX catalog by every PKG block before price and itinerary recovery', async () => {
    const raw = readFileSync(
      join(process.cwd(), 'src/lib/product-registration/golden-corpus/fixtures/xian-huashan-bx-multiproduct.txt'),
      'utf8',
    );

    const products = recoverCatalogSplitFromRawText(raw);

    expect(products).toHaveLength(4);
    expect(products.map(product => product.extractedData.title)).toEqual([
      'BX 서안/진시황릉+병마용 3박5일',
      'BX 서안/진시황릉+병마용 4박6일',
      '[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 3박5일',
      '[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 4박6일',
    ]);

    const premiumThreeNight = products[2]!;
    const premiumFourNight = products[3]!;
    const basicThreeNight = products[0]!;
    const premiumThreeNightRawText = premiumThreeNight.sectionRawText ?? '';
    const premiumFourNightRawText = premiumFourNight.sectionRawText ?? '';
    expect(premiumThreeNightRawText).not.toContain('품격 패키지 4박6일');
    const basicThreeNightFacts = extractSupplierRawDeterministicFacts(basicThreeNight.sectionRawText ?? '');
    expect(basicThreeNightFacts.inclusions).toContain('호텔(2인1실)');
    expect(basicThreeNightFacts.excludes).toEqual([
      '개인경비',
      '매너팁',
      '기사/가이드경비($50/인)',
      '강력추천옵션($150/인)',
    ]);
    expect(basicThreeNightFacts.optionalTours.map(tour => `${tour.name}:${tour.priceLabel}`)).toEqual([
      '장안가쇼:$70/인',
      '발마사지:$30/인',
      '전신마사지:$40/인',
      '화산(서봉):$180/인',
      '화산북봉:$120/인',
      '화산서약묘:$40/인',
      '실크로드쇼:$50/인',
      '한양능박물관 등:$35/인',
    ]);

    const threeNightPrice = await recoverUploadPriceData(
      { ...premiumThreeNight.extractedData, rawText: premiumThreeNightRawText },
      { rawText: premiumThreeNightRawText, year: 2026, enableGeminiFallback: false },
    );
    expect(threeNightPrice.ok).toBe(true);
    expect(threeNightPrice.source).toBe('supplier_raw_facts');
    expect(threeNightPrice.minPrice).toBe(979000);
    expect(threeNightPrice.priceDates.map(row => row.date)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-29',
      '2026-08-19',
    ]);
    expect(threeNightPrice.priceRows).toHaveLength(4);

    const fourNightPrice = await recoverUploadPriceData(
      { ...premiumFourNight.extractedData, rawText: premiumFourNightRawText },
      { rawText: premiumFourNightRawText, year: 2026, enableGeminiFallback: false },
    );
    expect(fourNightPrice.ok).toBe(true);
    expect(fourNightPrice.minPrice).toBe(1049000);
    expect(fourNightPrice.priceDates.map(row => row.date)).toEqual([
      '2026-07-04',
      '2026-07-18',
      '2026-08-22',
    ]);

    const threeNightItinerary = buildSupplierRawDeterministicItinerary(premiumThreeNightRawText);
    const fourNightItinerary = buildSupplierRawDeterministicItinerary(premiumFourNightRawText);
    const fourNightScheduleText = fourNightItinerary?.days.flatMap(day => day.schedule.map(item => item.activity)).join('\n') ?? '';
    expect(threeNightItinerary?.days.map(day => day.day)).toEqual([1, 2, 3, 4, 5]);
    expect(fourNightItinerary?.days.map(day => day.day)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(threeNightItinerary?.meta.nights).toBe(3);
    expect(fourNightItinerary?.meta.nights).toBe(4);
    expect(threeNightItinerary?.meta.flight_out).toBe('BX341');
    expect(threeNightItinerary?.meta.flight_in).toBe('BX342');
    expect(fourNightItinerary?.meta.flight_out).toBe('BX341');
    expect(fourNightItinerary?.meta.flight_in).toBe('BX342');
    expect(fourNightScheduleText).not.toContain('중국 패키지 상품 취소규정 안내');
    expect(fourNightScheduleText).not.toMatch(/^(서안|화산|부산)$/m);
  });
});
