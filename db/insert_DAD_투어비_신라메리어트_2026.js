/**
 * 투어비 — 다낭 신라모노그램 & 메리어트리조트 2026년 5~10월
 * BX에어부산 / LJ진에어 각 2개 호텔 = 4개 상품
 * 선발 마감: 2026-05-28
 */

'use strict';
const { createInserter } = require('./templates/insert-template');
const crypto = require('crypto');

// ─── Rule Zero: 원문 원본 불변 ───────────────────────────────
const RAW_TEXT = `<<2026년 부산 직항 저녁출발 BX에어부산 & LJ진에어 >>
▶ 다낭 신라모노그램&메리어트리조트 PKG ◀
26년 5~10월 출발 / 5월 선발 요금표

출발요일
부산/다낭
다낭/부산
데일리 BX773-774
20:50 – 23:50
00:45 - 07:20
데일리 증편 BX7315-7325
22:05 - 01:10
02:10 - 09:05


출발요일
부산/다낭
다낭/부산
데일리 LJ111-112
21:05 - 00:05
01:05 – 07:30

★ 5/28일까지 선발 조건 ★

필독
 * 여권기간은 반드시 6개월이상 유효기간이 남아 있어야 합니다
 * 미성년자(만 14세 미만) 베트남 입국 시 영문 가족관계증명서를 반드시 지참하셔야 합니다.
 (부모 또는 부모 중 1명만 여행해도 적용) **7/21일부로**
 * 부모미동반, 제 3자와 입국하는 경우에는 반드시 사전에 부모동의서 영어번역 후 공증을 지참해야합니다.
 * 25.1.1부터 베트남 입국시 전자담배 (액상, 가열, 궐련형 전부 금지) 반입 금지됩니다
    (소지 및 사용시 압수+벌금 약 50만동~300만동)
 * 전 상품 조인행사 진행될 수 있으며 현지에서 옵션안내 같이 드립니다 (실속+노팁노옵션상품)
 * 패키지상품으로 옵션 미진행시 부득이하게 대기해야합니다.

♥ 신라 모노그램 ♥
☑ 신라 모노그램 3박 숙박
☑ 신라 모노그램 망고빙수 룸당 1개 제공! 객실 미니바 1회 포함!
☑ 호이안 씨클로 + 소원등 + 전신 마사지 2시간 포함!
♥ 메리어트 리조트&스파 ♥
☑ 메리어트 리조트 3박 숙박
☑ 4인 이상 예약시 풀빌라 무료 업그레이드! ex) 4명 2베드, 6명 3베드
☑ 호이안 씨클로 + 소원등 + 전신 마사지 2시간 포함!

<<2026년 부산직항 다낭 LJ>> 5월~10월 출발 요금표★5/28까지 선발★

요  일
신라모노그램
메리어트 리조트
9/13~29
수 목 금
969,000
1,029,000
토 일 월 화
929,000
989,000
5/6~7/14
8/30~9/12
수 목 금
1,049,000
1,069,000
토 일 월 화
1,009,000
1,029,000
7/17~23
8/16~29
9/30~10/21
수 목 금
1,089,000
1,189,000
토 일 월 화
1,049,000
1,149,000
8/6~11
수 목 금
1,149,000
1,249,000
토 일 월 화
1,089,000
1,189,000
7/24~31
수 목 금
1,389,000
1,489,000
토 일 월 화
1,329,000
1,429,000
5/23, 30
6/2
제외일자
1,029,000
1,069,000
5/20
6/3
1,089,000
1,129,000
7/15
1,249,000
1,349,000
7/16
8/2, 3, 4, 5
9/25
10/3
1,309,000
1,409,000
8/1, 12, 13, 15
1,409,000
1,509,000
10/7
1,429,000
1,469,000
5/21, 22
8/14
9/22
10/1, 2, 8
1,489,000
1,549,000
9/24
1,649,000
1,709,000
9/23
1,949,000
2,009,000

<<2026년 부산직항 다낭 BX>> 5월~10월 출발 요금표★5/28까지 선발★

요  일
신라모노그램
메리어트 리조트
9/13~30
수 목 금
989,000
1,049,000
토 일 월 화
949,000
1,009,000
5/1~7/14
8/30~9/12
수 목 금
1,069,000
1,089,000
토 일 월 화
1,029,000
1,049,000
7/15~22
8/16~29
10/1~21
수 목 금
1,109,000
1,209,000
토 일 월 화
1,069,000
1,169,000
8/8~15
수 목 금
1,169,000
1,269,000
토 일 월 화
1,109,000
1,209,000
8/2~7
제외일자
1,309,000
1,409,000
7/23~28
1,349,000
1,449,000
5/23, 30
6/2
1,049,000
1,089,000
5/20
6/3, 7
9/30
10/4
1,109,000
1,149,000
7/15, 19
1,289,000
1,389,000
7/16
9/25
10/3
1,349,000
1,409,000
8/1, 12, 13, 16, 17
1,449,000
1,549,000
7/29, 30, 31
10/7, 11
1,489,000
1,589,000
5/21, 22, 25, 26
8/14, 18
9/22
10/1, 2, 5, 6, 8, 12
1,509,000
1,569,000
5/2, 6
1,609,000
1,649,000
9/24, 28
1,669,000
1,729,000
5/1, 5
9/23, 27
1,969,000
2,029,000

 [BX,LJ] 다낭/호이안 신라모노그램 노팁노옵션 3박5일
기    간
2026년 出
룸 타 입
전일정 5성 (2인1실 기준)
인 원 수
4명부터 출발
차    량
전용 차량
포    함
 ▶ 왕복국제선항공료 및 텍스, 유류할증료, 여행자보험
 ▶ 호텔 숙박, 차량, 한국인 가이드, 관광지 입장료, 일정표 상의 식사, 가이드팁
 ▶ 호이안 관광 + 투본강 보트투어, 바나산 국립공원 케이블카 체험 & 테마파크 이용
 ▶ 전신마사지 2시간 +바구니배 +호이안야투&씨클로 +한강유람선 +헬리오or손짜 야시장
 ▶ 특식 – 소고기 샤브샤브, 호이안전통식, 퓨전뷔페, 쭈꾸미삼겹살, 노니보쌈, 무제한삼겹살
 ▶ 신라모노그램 숙박 특전 - 신라모노그램 망고빙수 룸당 1개 제공, 객실 미니바 1회 제공(생수2,음료2,맥주2)
불 포 함
 ▶ 매너팁 및 개인경비   ▶ 마사지팁 60분 $2, 90분 $3, 120분 $4
 ▶ 써차지 : 4/26~5/2 (왕조/해방기념일,노동절), 9/24~27 (추석연휴)
            – 1인 1박 3만원씩 추가
R M K
 ※예약 시 호텔 체크 필수입니다
 ▶ 호텔 베드타입은 트윈/더블 랜덤 배정됩니다. 정확한 베드타입은 체크인시 확인 가능합니다.
 ▶ 싱글차지 1인 3박 33만원 추가
 ▶ 쇼핑센터 – 침향&노니 / 커피 / 잡화 3회 방문 – 현지사정으로 쇼핑센터 변경될 수 있습니다.
 ▶ 일정 미참여시 패널티 1인 $100/1박당 적용
 ▶ 실속+노노 및 타 항공사(타 지역) 조인행사 진행될 수 있으며 공항대기발생 및 옵션안내 같이 드립니다.
 ▶ 여권유효기간은 반드시 6개월 이상 남아 있어야 합니다. 여권기간 만료시 여행사는 책임지지 않습니다
 ▶ 미성년자 (만 14세 미만) 청소년 베트남 입국 시 주의 사항
    - 부모와 동행해도 영문 가족관계증명서 반드시 지참
    - 부모 미동행시 부모로부터 받은 위임장(베트남어 또는 영어로 공증)과 영문 가족관계증명서 반드시 지참
 ▶ 25.1.1부터 베트남 입국시 전자담배 (액상, 가열, 궐련형 전부 금지) 반입 금지됩니다
    (소지 및 사용시 압수+벌금 약 50만동~300만동)
일 자
지 역
교통편
시 간
일               정
식사
제1일
부  산

다  낭

BX/LJ

전용차량
18:00
20:50
23:50

 부산 국제공항 출국수속
 부산 국제공항 출발
 다낭 도착 후 가이드 미팅
 호텔 이동 및 CHECK-IN /  호텔 휴식
석:간편기내식
(콜드밀)
 HOTEL : 5성 – 다낭 신라 모노그램
제2일
다  낭


호이안



다 낭


전용차량

 호텔 조식 후 가이드 미팅
 여행의 피로를 풀어주는 전신마사지 2시간 체험 (팁별도)
 중식 후 산 전체가 화려한 대리석으로 이루어진 마블 마운틴(오행산) 관광
 호이안으로 이동 (약30분소요)
 베트남 전통 바구니배 체험 (팁 $1별도)
 투본강 보트를 타고 투본강 투어
 호이안 구시가지 핵심 투어 (떤키의집, 내원교, 풍흥의집, 광조회관)
 호이안 야경투어 & 강가에서 소원등 띄우기 & 씨클로 체험 (팁 $1 별도)
 석식 후 다낭 귀환 (약 30분 소요)
 호텔 투숙 및 휴식
조:호텔식
중:샤브샤브
석:호이안전통식
 HOTEL : 5성 – 다낭 신라 모노그램
제3일
다  낭

전용차량

 호텔 조식 후 오전 자유시간
 11시경 가이드 미팅 후 중식
 베트남 특산 세계3대 커피 위즐커피 시음
 바나산 국립공원 – 골든브릿지 & 왕복케이블카 & 자유이용권
 ->해발 1487M 국립공원 바나힐을 기네스북(5043M)에 등재된 케이블카를
  탑승하여 울창한 밀림과 자연경관을 관광
 한강유람선 체험
 호텔 투숙 및 휴식
조:호텔식
중:쭈꾸미삼겹살
석:바나힐뷔페
 HOTEL : 5성 – 다낭 신라 모노그램
제4일
다  낭

전용차랑

 호텔 조식 후 체크아웃
 베트남 특산품 관광 3회
 높이 67m의 베트남에서 가장 큰 해수 관음상, 선짜반도 영응사 관광
 열대과일 시식(골드망고)
 베1923년 프랑스 점령기에 건축된 분홍색 예쁜 외관의 다낭 대성당(핑크성당)
 헬리오 야시장 or 선짜 야시장 방문
 석식 후 공항으로 이동
조:호텔식
중:노니보쌈
석:무제한삼겹살
제5일
다  낭
부  산
BX/LJ

00:45
07:20
 다낭 출발 / 부산 향발
 부산 도착
조:불포함

 [BX,LJ] 다낭/호이안 메리어트 리조트 노팁노옵션 3박5일
기    간
2026년 出
룸 타 입
전일정 5성 (2인1실 기준)
인 원 수
4명부터 출발
차    량
전용 차량
포    함
 ▶ 왕복국제선항공료 및 텍스, 유류할증료, 여행자보험
 ▶ 호텔 숙박, 차량, 한국인 가이드, 관광지 입장료, 일정표 상의 식사, 가이드팁
 ▶ 호이안 관광 + 투본강 보트투어, 바나산 국립공원 케이블카 체험 & 테마파크 이용
 ▶ 전신마사지 2시간 +바구니배 +호이안야투&씨클로 +한강유람선 +헬리오or손짜 야시장
 ▶ 특식 – 소고기 샤브샤브, 호이안전통식, 퓨전뷔페, 쭈꾸미삼겹살, 노니보쌈, 무제한삼겹살
 ▶ 메리어트 리조트 숙박 특전
    4인 이상 예약시 메리어트 리조트 3박 ---> 풀빌라 무료 업그레이드!!! (사전 확인 必)
   4명시 2베드 / 6명시 3베드
불 포 함
 ▶ 매너팁 및 개인경비   ▶ 마사지팁 60분 $2, 90분 $3, 120분 $4
 ▶ 써차지 : 4/26~5/2 (왕조/해방기념일,노동절), 5/30, 6/6,13,20,27, 7/11 (불꽃축제), 9/1,2 (독립기념일)
            – 1인 1박 3만원씩 추가
R M K
 ※예약 시 호텔 체크 필수입니다
 ▶ 호텔 베드타입은 트윈/더블 랜덤 배정됩니다. 정확한 베드타입은 체크인시 확인 가능합니다.
 ▶ 싱글차지 1인 3박 26만원
 ▶ 쇼핑센터 – 침향&노니 / 커피 / 잡화 3회 방문 – 현지사정으로 쇼핑센터 변경될 수 있습니다.
 ▶ 일정 미참여시 패널티 1인 $100/1박당 적용
 ▶ 실속+노노 및 타 항공사(타 지역) 조인행사 진행될 수 있으며 공항대기발생 및 옵션안내 같이 드립니다.
 ▶ 여권유효기간은 반드시 6개월 이상 남아 있어야 합니다. 여권기간 만료시 여행사는 책임지지 않습니다
 ▶ 미성년자 (만 14세 미만) 청소년 베트남 입국 시 주의 사항
    - 부모와 동행해도 영문 가족관계증명서 반드시 지참
    - 부모 미동행시 부모로부터 받은 위임장(베트남어 또는 영어로 공증)과 영문 가족관계증명서 반드시 지참
 ▶ 25.1.1부터 베트남 입국시 전자담배 (액상, 가열, 궐련형 전부 금지) 반입 금지됩니다
    (소지 및 사용시 압수+벌금 약 50만동~300만동)`;

const RAW_TEXT_HASH = crypto.createHash('sha256').update(RAW_TEXT).digest('hex');

// ─── price_dates 빌더 ─────────────────────────────────────────
const DOW_KO = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

function buildPriceDates(exceptions, rangeTiers) {
  const seen = new Set();
  const result = [];

  // 1. 개별 예외 날짜 먼저 (seen Set이 range tier 오버라이드 방지)
  for (const { dates, price } of exceptions) {
    for (const d of dates) {
      if (!seen.has(d)) { seen.add(d); result.push({ date: d, price }); }
    }
  }

  // 2. 범위 tier (개별 예외가 이미 seen에 있으면 skip)
  for (const { start, end, dows, price } of rangeTiers) {
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    const c = new Date(sy, sm - 1, sd);
    const endD = new Date(ey, em - 1, ed);
    const dowSet = new Set(dows.map(d => DOW_KO[d]));
    while (c <= endD) {
      if (dowSet.size === 0 || dowSet.has(c.getDay())) {
        const iso = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
        if (!seen.has(iso)) { seen.add(iso); result.push({ date: iso, price }); }
      }
      c.setDate(c.getDate() + 1);
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

const ALL_DOW = ['일', '월', '화', '수', '목', '금', '토'];
const WED_THU_FRI = ['수', '목', '금'];
const SAT_SUN_MON_TUE = ['토', '일', '월', '화'];

// ─── 가격표: LJ 신라 모노그램 ─────────────────────────────────
const PD_LJ_신라 = buildPriceDates(
  [
    { dates: ['2026-05-23', '2026-05-30', '2026-06-02'], price: 1029000 },
    { dates: ['2026-05-20', '2026-06-03'], price: 1089000 },
    { dates: ['2026-07-15'], price: 1249000 },
    { dates: ['2026-07-16', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-09-25', '2026-10-03'], price: 1309000 },
    { dates: ['2026-08-01', '2026-08-12', '2026-08-13', '2026-08-15'], price: 1409000 },
    { dates: ['2026-10-07'], price: 1429000 },
    { dates: ['2026-05-21', '2026-05-22', '2026-08-14', '2026-09-22', '2026-10-01', '2026-10-02', '2026-10-08'], price: 1489000 },
    { dates: ['2026-09-24'], price: 1649000 },
    { dates: ['2026-09-23'], price: 1949000 },
  ],
  [
    { start: '2026-09-13', end: '2026-09-29', dows: WED_THU_FRI, price: 969000 },
    { start: '2026-09-13', end: '2026-09-29', dows: SAT_SUN_MON_TUE, price: 929000 },
    { start: '2026-05-06', end: '2026-07-14', dows: WED_THU_FRI, price: 1049000 },
    { start: '2026-05-06', end: '2026-07-14', dows: SAT_SUN_MON_TUE, price: 1009000 },
    { start: '2026-08-30', end: '2026-09-12', dows: WED_THU_FRI, price: 1049000 },
    { start: '2026-08-30', end: '2026-09-12', dows: SAT_SUN_MON_TUE, price: 1009000 },
    { start: '2026-07-17', end: '2026-07-23', dows: WED_THU_FRI, price: 1089000 },
    { start: '2026-07-17', end: '2026-07-23', dows: SAT_SUN_MON_TUE, price: 1049000 },
    { start: '2026-08-16', end: '2026-08-29', dows: WED_THU_FRI, price: 1089000 },
    { start: '2026-08-16', end: '2026-08-29', dows: SAT_SUN_MON_TUE, price: 1049000 },
    { start: '2026-09-30', end: '2026-10-21', dows: WED_THU_FRI, price: 1089000 },
    { start: '2026-09-30', end: '2026-10-21', dows: SAT_SUN_MON_TUE, price: 1049000 },
    { start: '2026-08-06', end: '2026-08-11', dows: WED_THU_FRI, price: 1149000 },
    { start: '2026-08-06', end: '2026-08-11', dows: SAT_SUN_MON_TUE, price: 1089000 },
    { start: '2026-07-24', end: '2026-07-31', dows: WED_THU_FRI, price: 1389000 },
    { start: '2026-07-24', end: '2026-07-31', dows: SAT_SUN_MON_TUE, price: 1329000 },
  ]
);

// ─── 가격표: LJ 메리어트 리조트 ──────────────────────────────
const PD_LJ_메리어트 = buildPriceDates(
  [
    { dates: ['2026-05-23', '2026-05-30', '2026-06-02'], price: 1069000 },
    { dates: ['2026-05-20', '2026-06-03'], price: 1129000 },
    { dates: ['2026-07-15'], price: 1349000 },
    { dates: ['2026-07-16', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-09-25', '2026-10-03'], price: 1409000 },
    { dates: ['2026-08-01', '2026-08-12', '2026-08-13', '2026-08-15'], price: 1509000 },
    { dates: ['2026-10-07'], price: 1469000 },
    { dates: ['2026-05-21', '2026-05-22', '2026-08-14', '2026-09-22', '2026-10-01', '2026-10-02', '2026-10-08'], price: 1549000 },
    { dates: ['2026-09-24'], price: 1709000 },
    { dates: ['2026-09-23'], price: 2009000 },
  ],
  [
    { start: '2026-09-13', end: '2026-09-29', dows: WED_THU_FRI, price: 1029000 },
    { start: '2026-09-13', end: '2026-09-29', dows: SAT_SUN_MON_TUE, price: 989000 },
    { start: '2026-05-06', end: '2026-07-14', dows: WED_THU_FRI, price: 1069000 },
    { start: '2026-05-06', end: '2026-07-14', dows: SAT_SUN_MON_TUE, price: 1029000 },
    { start: '2026-08-30', end: '2026-09-12', dows: WED_THU_FRI, price: 1069000 },
    { start: '2026-08-30', end: '2026-09-12', dows: SAT_SUN_MON_TUE, price: 1029000 },
    { start: '2026-07-17', end: '2026-07-23', dows: WED_THU_FRI, price: 1189000 },
    { start: '2026-07-17', end: '2026-07-23', dows: SAT_SUN_MON_TUE, price: 1149000 },
    { start: '2026-08-16', end: '2026-08-29', dows: WED_THU_FRI, price: 1189000 },
    { start: '2026-08-16', end: '2026-08-29', dows: SAT_SUN_MON_TUE, price: 1149000 },
    { start: '2026-09-30', end: '2026-10-21', dows: WED_THU_FRI, price: 1189000 },
    { start: '2026-09-30', end: '2026-10-21', dows: SAT_SUN_MON_TUE, price: 1149000 },
    { start: '2026-08-06', end: '2026-08-11', dows: WED_THU_FRI, price: 1249000 },
    { start: '2026-08-06', end: '2026-08-11', dows: SAT_SUN_MON_TUE, price: 1189000 },
    { start: '2026-07-24', end: '2026-07-31', dows: WED_THU_FRI, price: 1489000 },
    { start: '2026-07-24', end: '2026-07-31', dows: SAT_SUN_MON_TUE, price: 1429000 },
  ]
);

// ─── 가격표: BX 신라 모노그램 ─────────────────────────────────
const PD_BX_신라 = buildPriceDates(
  [
    { dates: ['2026-05-23', '2026-05-30', '2026-06-02'], price: 1049000 },
    { dates: ['2026-05-20', '2026-06-03', '2026-06-07', '2026-09-30', '2026-10-04'], price: 1109000 },
    { dates: ['2026-07-15', '2026-07-19'], price: 1289000 },
    { dates: ['2026-07-16', '2026-09-25', '2026-10-03'], price: 1349000 },
    { dates: ['2026-08-01', '2026-08-12', '2026-08-13', '2026-08-16', '2026-08-17'], price: 1449000 },
    { dates: ['2026-07-29', '2026-07-30', '2026-07-31', '2026-10-07', '2026-10-11'], price: 1489000 },
    { dates: ['2026-05-21', '2026-05-22', '2026-05-25', '2026-05-26', '2026-08-14', '2026-08-18', '2026-09-22', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-08', '2026-10-12'], price: 1509000 },
    { dates: ['2026-05-02', '2026-05-06'], price: 1609000 },
    { dates: ['2026-09-24', '2026-09-28'], price: 1669000 },
    { dates: ['2026-05-01', '2026-05-05', '2026-09-23', '2026-09-27'], price: 1969000 },
  ],
  [
    { start: '2026-09-13', end: '2026-09-30', dows: WED_THU_FRI, price: 989000 },
    { start: '2026-09-13', end: '2026-09-30', dows: SAT_SUN_MON_TUE, price: 949000 },
    { start: '2026-05-01', end: '2026-07-14', dows: WED_THU_FRI, price: 1069000 },
    { start: '2026-05-01', end: '2026-07-14', dows: SAT_SUN_MON_TUE, price: 1029000 },
    { start: '2026-08-30', end: '2026-09-12', dows: WED_THU_FRI, price: 1069000 },
    { start: '2026-08-30', end: '2026-09-12', dows: SAT_SUN_MON_TUE, price: 1029000 },
    { start: '2026-07-15', end: '2026-07-22', dows: WED_THU_FRI, price: 1109000 },
    { start: '2026-07-15', end: '2026-07-22', dows: SAT_SUN_MON_TUE, price: 1069000 },
    { start: '2026-08-16', end: '2026-08-29', dows: WED_THU_FRI, price: 1109000 },
    { start: '2026-08-16', end: '2026-08-29', dows: SAT_SUN_MON_TUE, price: 1069000 },
    { start: '2026-10-01', end: '2026-10-21', dows: WED_THU_FRI, price: 1109000 },
    { start: '2026-10-01', end: '2026-10-21', dows: SAT_SUN_MON_TUE, price: 1069000 },
    { start: '2026-08-08', end: '2026-08-15', dows: WED_THU_FRI, price: 1169000 },
    { start: '2026-08-08', end: '2026-08-15', dows: SAT_SUN_MON_TUE, price: 1109000 },
    // 8/2~8/7 전 요일 동일가
    { start: '2026-08-02', end: '2026-08-07', dows: ALL_DOW, price: 1309000 },
    // 7/23~7/28 전 요일 동일가
    { start: '2026-07-23', end: '2026-07-28', dows: ALL_DOW, price: 1349000 },
  ]
);

// ─── 가격표: BX 메리어트 리조트 ──────────────────────────────
const PD_BX_메리어트 = buildPriceDates(
  [
    { dates: ['2026-05-23', '2026-05-30', '2026-06-02'], price: 1089000 },
    { dates: ['2026-05-20', '2026-06-03', '2026-06-07', '2026-09-30', '2026-10-04'], price: 1149000 },
    { dates: ['2026-07-15', '2026-07-19'], price: 1389000 },
    { dates: ['2026-07-16', '2026-09-25', '2026-10-03'], price: 1409000 },
    { dates: ['2026-08-01', '2026-08-12', '2026-08-13', '2026-08-16', '2026-08-17'], price: 1549000 },
    { dates: ['2026-07-29', '2026-07-30', '2026-07-31', '2026-10-07', '2026-10-11'], price: 1589000 },
    { dates: ['2026-05-21', '2026-05-22', '2026-05-25', '2026-05-26', '2026-08-14', '2026-08-18', '2026-09-22', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-08', '2026-10-12'], price: 1569000 },
    { dates: ['2026-05-02', '2026-05-06'], price: 1649000 },
    { dates: ['2026-09-24', '2026-09-28'], price: 1729000 },
    { dates: ['2026-05-01', '2026-05-05', '2026-09-23', '2026-09-27'], price: 2029000 },
  ],
  [
    { start: '2026-09-13', end: '2026-09-30', dows: WED_THU_FRI, price: 1049000 },
    { start: '2026-09-13', end: '2026-09-30', dows: SAT_SUN_MON_TUE, price: 1009000 },
    { start: '2026-05-01', end: '2026-07-14', dows: WED_THU_FRI, price: 1089000 },
    { start: '2026-05-01', end: '2026-07-14', dows: SAT_SUN_MON_TUE, price: 1049000 },
    { start: '2026-08-30', end: '2026-09-12', dows: WED_THU_FRI, price: 1089000 },
    { start: '2026-08-30', end: '2026-09-12', dows: SAT_SUN_MON_TUE, price: 1049000 },
    { start: '2026-07-15', end: '2026-07-22', dows: WED_THU_FRI, price: 1209000 },
    { start: '2026-07-15', end: '2026-07-22', dows: SAT_SUN_MON_TUE, price: 1169000 },
    { start: '2026-08-16', end: '2026-08-29', dows: WED_THU_FRI, price: 1209000 },
    { start: '2026-08-16', end: '2026-08-29', dows: SAT_SUN_MON_TUE, price: 1169000 },
    { start: '2026-10-01', end: '2026-10-21', dows: WED_THU_FRI, price: 1209000 },
    { start: '2026-10-01', end: '2026-10-21', dows: SAT_SUN_MON_TUE, price: 1169000 },
    { start: '2026-08-08', end: '2026-08-15', dows: WED_THU_FRI, price: 1269000 },
    { start: '2026-08-08', end: '2026-08-15', dows: SAT_SUN_MON_TUE, price: 1209000 },
    { start: '2026-08-02', end: '2026-08-07', dows: ALL_DOW, price: 1409000 },
    { start: '2026-07-23', end: '2026-07-28', dows: ALL_DOW, price: 1449000 },
  ]
);

// ─── 써차지 ───────────────────────────────────────────────────
const SURCHARGES_신라 = [
  { name: '왕조/해방기념일·노동절', start: '2026-04-26', end: '2026-05-02', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '추석연휴', start: '2026-09-24', end: '2026-09-27', amount: 30000, currency: 'KRW', unit: '인/박' },
];

const SURCHARGES_메리어트 = [
  { name: '왕조/해방기념일·노동절', start: '2026-04-26', end: '2026-05-02', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '다낭 불꽃축제', start: '2026-05-30', end: '2026-05-30', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '다낭 불꽃축제', start: '2026-06-06', end: '2026-06-06', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '다낭 불꽃축제', start: '2026-06-13', end: '2026-06-13', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '다낭 불꽃축제', start: '2026-06-20', end: '2026-06-20', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '다낭 불꽃축제', start: '2026-06-27', end: '2026-06-27', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '다낭 불꽃축제', start: '2026-07-11', end: '2026-07-11', amount: 30000, currency: 'KRW', unit: '인/박' },
  { name: '독립기념일', start: '2026-09-01', end: '2026-09-02', amount: 30000, currency: 'KRW', unit: '인/박' },
];

// ─── 공통 포함사항 ─────────────────────────────────────────────
const INCLUSIONS_BASE = [
  '왕복국제선항공료 및 텍스',
  '유류할증료',
  '여행자보험',
  '호텔 숙박',
  '차량',
  '한국인 가이드',
  '관광지 입장료',
  '일정표 상의 식사',
  '가이드팁',
  '호이안 관광 + 투본강 보트투어',
  '바나산 국립공원 케이블카 체험 & 테마파크 이용',
  '전신마사지 2시간',
  '바구니배',
  '호이안야투&씨클로',
  '한강유람선',
  '헬리오or손짜 야시장',
  '특식 – 소고기 샤브샤브',
  '호이안전통식',
  '퓨전뷔페',
  '쭈꾸미삼겹살',
  '노니보쌈',
  '무제한삼겹살',
];

const INCLUSIONS_신라 = [
  ...INCLUSIONS_BASE,
  '신라모노그램 망고빙수 룸당 1개 제공',
  '객실 미니바 1회 제공(생수2,음료2,맥주2)',
];

const INCLUSIONS_메리어트 = [
  ...INCLUSIONS_BASE,
  '4인 이상 예약시 메리어트 리조트 3박 ---> 풀빌라 무료 업그레이드',
];

// ─── 불포함사항 ───────────────────────────────────────────────
const EXCLUDES = [
  '매너팁 및 개인경비',
  '마사지팁 60분 $2, 90분 $3, 120분 $4',
  '써차지 (별도 고지)',
];

// ─── 유의사항 ─────────────────────────────────────────────────
const NOTICES_BASE = [
  { type: 'required', text: '예약 시 호텔 체크 필수입니다' },
  { type: 'info', text: '호텔 베드타입은 트윈/더블 랜덤 배정됩니다. 정확한 베드타입은 체크인시 확인 가능합니다.' },
  { type: 'info', text: '쇼핑센터 – 침향&노니 / 커피 / 잡화 3회 방문 – 현지사정으로 쇼핑센터 변경될 수 있습니다.' },
  { type: 'info', text: '일정 미참여시 패널티 1인 $100/1박당 적용' },
  { type: 'info', text: '실속+노노 및 타 항공사(타 지역) 조인행사 진행될 수 있으며 공항대기발생 및 옵션안내 같이 드립니다.' },
  { type: 'required', text: '여권유효기간은 반드시 6개월 이상 남아 있어야 합니다. 여권기간 만료시 여행사는 책임지지 않습니다' },
  { type: 'required', text: '미성년자 (만 14세 미만) 청소년 베트남 입국 시: 부모와 동행해도 영문 가족관계증명서 반드시 지참. 부모 미동행시 부모로부터 받은 위임장(베트남어 또는 영어로 공증)과 영문 가족관계증명서 반드시 지참' },
  { type: 'required', text: '25.1.1부터 베트남 입국시 전자담배 (액상, 가열, 궐련형 전부 금지) 반입 금지됩니다 (소지 및 사용시 압수+벌금 약 50만동~300만동)' },
];

const NOTICES_신라 = [
  { type: 'info', text: '싱글차지 1인 3박 33만원 추가' },
  ...NOTICES_BASE,
];

const NOTICES_메리어트 = [
  { type: 'info', text: '싱글차지 1인 3박 26만원' },
  { type: 'info', text: '4인 이상 예약시 메리어트 리조트 3박 ---> 풀빌라 무료 업그레이드!!! (사전 확인 必) 4명시 2베드 / 6명시 3베드' },
  ...NOTICES_BASE,
];

// ─── 일정 생성 팩토리 ─────────────────────────────────────────
function makeItinerary({ hotelName, hotelNote, airline, flightOutCode, flightOutTime, flightArrTime, flightInCode, flightInTime, flightRetArrTime, highlightsInclusions }) {
  const n = (time, activity, note) => ({ type: 'normal', time: time || null, activity, note: note || null });
  const f = (time, activity, transport) => ({ type: 'flight', time: time || null, activity, transport: transport || null, note: null });
  const s = (time, activity, note) => ({ type: 'shopping', time: time || null, activity, note: note || null });
  const m = (b, l, d) => ({ breakfast: b || null, lunch: l || null, dinner: d || null });

  return {
    meta: {
      airline,
      flight_out: `${flightOutCode} ${flightOutTime}`,
      flight_out_time: flightOutTime,
      flight_in: `${flightInCode} ${flightInTime}`,
      departure_airport: '부산',
      arrival_airport: '다낭',
      duration_nights: 3,
      duration_days: 5,
    },
    days: [
      {
        day: 1,
        regions: ['부산', '다낭'],
        schedule: [
          n('18:00', '▶부산 국제공항 출국수속'),
          f(flightOutTime, `부산 출발 → 다낭 도착 ${flightArrTime}`, flightOutCode),
          n(flightArrTime, '▶다낭 도착 후 가이드 미팅'),
          n(null, '호텔 이동 및 CHECK-IN'),
          n(null, '호텔 휴식'),
        ],
        meals: m(null, null, '간편기내식(콜드밀)'),
        hotel: { name: hotelName, grade: 5, note: hotelNote },
      },
      {
        day: 2,
        regions: ['다낭', '호이안', '다낭'],
        schedule: [
          n('오전', '▶호텔 조식 후 가이드 미팅'),
          n(null, '▶여행의 피로를 풀어주는 전신마사지 2시간 체험 (팁별도)'),
          n(null, '▶마블 마운틴(오행산) 관광'),
          n(null, '▶호이안으로 이동 (약30분소요)'),
          n('오후', '▶베트남 전통 바구니배 체험 (팁 $1별도)'),
          n(null, '▶투본강 보트를 타고 투본강 투어'),
          n(null, '▶호이안 구시가지 핵심 투어 (떤키의집, 내원교, 풍흥의집, 광조회관)'),
          n(null, '▶호이안 야경투어 & 강가에서 소원등 띄우기 & 씨클로 체험 (팁 $1 별도)'),
          n(null, '▶석식 후 다낭 귀환 (약 30분 소요)'),
          n(null, '호텔 투숙 및 휴식'),
        ],
        meals: m('호텔식', '샤브샤브', '호이안전통식'),
        hotel: { name: hotelName, grade: 5, note: hotelNote },
      },
      {
        day: 3,
        regions: ['다낭'],
        schedule: [
          n('오전', '▶호텔 조식 후 오전 자유시간'),
          n('11:00', '▶가이드 미팅 후 중식'),
          n(null, '▶베트남 특산 세계3대 커피 위즐커피 시음'),
          n('오후', '▶바나산 국립공원 – 골든브릿지 & 왕복케이블카 & 자유이용권'),
          n(null, '▶한강유람선 체험'),
          n(null, '호텔 투숙 및 휴식'),
        ],
        meals: m('호텔식', '쭈꾸미삼겹살', '바나힐뷔페'),
        hotel: { name: hotelName, grade: 5, note: hotelNote },
      },
      {
        day: 4,
        regions: ['다낭'],
        schedule: [
          n('오전', '▶호텔 조식 후 체크아웃'),
          s(null, '▶베트남 특산품 관광 3회'),
          n(null, '▶높이 67m의 베트남에서 가장 큰 해수 관음상, 선짜반도 영응사 관광'),
          n(null, '▶열대과일 시식(골드망고)'),
          n('오후', '▶베1923년 프랑스 점령기에 건축된 분홍색 예쁜 외관의 다낭 대성당(핑크성당)'),
          n(null, '▶헬리오 야시장 or 선짜 야시장 방문'),
          n(null, '▶석식 후 공항으로 이동'),
        ],
        meals: m('호텔식', '노니보쌈', '무제한삼겹살'),
        hotel: null,
      },
      {
        day: 5,
        regions: ['다낭', '부산'],
        schedule: [
          f(flightInTime, `다낭 출발 → 부산 도착 ${flightRetArrTime}`, flightInCode),
          n(flightRetArrTime, '▶부산 도착'),
        ],
        meals: m(null, null, null),
        hotel: null,
      },
    ],
    highlights: {
      inclusions: highlightsInclusions || INCLUSIONS_BASE,
      remarks: [
        '쇼핑센터 3회 방문 (침향&노니·커피·잡화)',
        '전 상품 조인행사 가능',
        '마사지팁 별도 (120분 $4)',
      ],
    },
  };
}

// ─── Self-audit (Step 6.5) ─────────────────────────────────────
const AGENT_AUDIT = {
  overall_verdict: 'clean',
  unsupported_critical: 0,
  unsupported_high: 0,
  claims: [
    { field: 'duration', value: '3박5일', supported: true, evidence: '기    간: 2026년 出 / 제1일~제5일' },
    { field: 'nights', value: '3', supported: true, evidence: 'HOTEL 3박 숙박' },
    { field: 'min_participants', value: '4명', supported: true, evidence: '인 원 수: 4명부터 출발' },
    { field: 'country', value: '베트남', supported: true, evidence: '다낭/호이안은 베트남 소재' },
    { field: 'destination', value: '다낭', supported: true, evidence: '다낭 도착/출발' },
    { field: 'surcharges_신라', value: '왕조/노동절·추석연휴 30,000/인/박', supported: true, evidence: '써차지 : 4/26~5/2, 9/24~27 – 1인 1박 3만원씩 추가' },
    { field: 'surcharges_메리어트', value: '왕조/노동절·불꽃축제×6·독립기념일 30,000/인/박', supported: true, evidence: '써차지 : 4/26~5/2, 5/30, 6/6,13,20,27, 7/11, 9/1,2 – 1인 1박 3만원씩 추가' },
    { field: 'single_supplement_신라', value: '330,000원(3박)', supported: true, evidence: '싱글차지 1인 3박 33만원 추가' },
    { field: 'single_supplement_메리어트', value: '260,000원(3박)', supported: true, evidence: '싱글차지 1인 3박 26만원' },
    { field: 'LJ_flight_out', value: 'LJ111 21:05 부산→다낭 00:05', supported: true, evidence: '데일리 LJ111-112 21:05 - 00:05' },
    { field: 'BX_flight_out', value: 'BX773 20:50 부산→다낭 23:50', supported: true, evidence: '데일리 BX773-774 20:50 – 23:50' },
    { field: 'ticketing_deadline', value: '2026-05-28', supported: true, evidence: '★ 5/28일까지 선발 조건 ★' },
    { field: 'inclusions_massagetip', value: '마사지팁 불포함(별도)', supported: true, evidence: '마사지팁 60분 $2, 90분 $3, 120분 $4' },
    { field: 'shopping_count', value: '3회', supported: true, evidence: '쇼핑센터 – 침향&노니 / 커피 / 잡화 3회 방문' },
  ],
};

// ─── 4개 상품 정의 ────────────────────────────────────────────
const ALL_PACKAGES = [

  // ① LJ 진에어 × 신라 모노그램
  {
    title: '[LJ 진에어] 다낭/호이안 신라모노그램 노팁노옵션 3박5일',
    display_title: '다낭 신라모노그램 3박5일',
    hero_tagline: '부산 직항 LJ진에어 · 망고빙수·미니바 포함',
    destination: '다낭',
    country: '베트남',
    duration: 5,
    nights: 3,
    departure_airport: '부산',
    airline: 'LJ 진에어',
    product_type: '실속+노팁노옵션',
    trip_style: ['커플', '가족', '친구'],
    min_participants: 4,
    price: 929000,
    single_supplement: 330000,
    surcharges: SURCHARGES_신라,
    excluded_dates: [],
    inclusions: INCLUSIONS_신라,
    excludes: EXCLUDES,
    notices_parsed: NOTICES_신라,
    product_highlights: [
      '부산 직항 LJ진에어',
      '5성 신라 모노그램 3박 (망고빙수·미니바 포함)',
      '기사·가이드팁 전부 포함',
      '전신마사지 2시간 포함',
      '바나힐 골든브릿지·케이블카',
    ],
    product_summary: '부산에서 바로 날아가는 LJ진에어 직항 다낭 패키지예요. 신라 모노그램 5성급 호텔 3박에 망고빙수·미니바까지 챙겨드리고, 기사팁·가이드팁 걱정 없이 편하게 다녀오실 수 있어요. 호이안 야경 씨클로부터 바나힐 골든브릿지까지 알찬 일정으로 꽉 채워드립니다!',
    product_tags: ['다낭', '직항', '노팁', '노옵션', '5성', '호이안', '바나힐', '신라모노그램'],
    accommodations: [{ name: '다낭 신라 모노그램', grade: 5, nights: 3, note: '5성급 리조트' }],
    price_dates: PD_LJ_신라,
    itinerary_data: makeItinerary({
      hotelName: '다낭 신라 모노그램',
      hotelNote: '5성급 리조트',
      airline: 'LJ 진에어',
      flightOutCode: 'LJ111',
      flightOutTime: '21:05',
      flightArrTime: '00:05',
      flightInCode: 'LJ112',
      flightInTime: '01:05',
      flightRetArrTime: '07:30',
      highlightsInclusions: INCLUSIONS_신라,
    }),
    customer_notes: '전 상품 조인행사 진행될 수 있으며 현지에서 옵션 안내 함께 드립니다.',
    internal_notes: '투어비 선발 마감 2026-05-28. 조인 상품(실속+노노). 추석연휴(9/24~27) 써차지 1인 1박 3만원 별도.',
    raw_text: RAW_TEXT,
    raw_text_hash: RAW_TEXT_HASH,
    agent_audit_report: AGENT_AUDIT,
    confidence: 0.96,
    filename: 'manual',
    file_type: 'manual',
  },

  // ② BX 에어부산 × 신라 모노그램
  {
    title: '[BX 에어부산] 다낭/호이안 신라모노그램 노팁노옵션 3박5일',
    display_title: '다낭 신라모노그램 3박5일',
    hero_tagline: '부산 직항 BX에어부산 · 망고빙수·미니바 포함',
    destination: '다낭',
    country: '베트남',
    duration: 5,
    nights: 3,
    departure_airport: '부산',
    airline: 'BX 에어부산',
    product_type: '실속+노팁노옵션',
    trip_style: ['커플', '가족', '친구'],
    min_participants: 4,
    price: 949000,
    single_supplement: 330000,
    surcharges: SURCHARGES_신라,
    excluded_dates: [],
    inclusions: INCLUSIONS_신라,
    excludes: EXCLUDES,
    notices_parsed: NOTICES_신라,
    product_highlights: [
      '부산 직항 BX에어부산',
      '5성 신라 모노그램 3박 (망고빙수·미니바 포함)',
      '기사·가이드팁 전부 포함',
      '전신마사지 2시간 포함',
      '바나힐 골든브릿지·케이블카',
    ],
    product_summary: '부산에서 바로 날아가는 BX에어부산 직항 다낭 패키지예요. 신라 모노그램 5성급 호텔 3박에 망고빙수·미니바까지 챙겨드리고, 기사팁·가이드팁 걱정 없이 편하게 다녀오실 수 있어요. 호이안 야경 씨클로부터 바나힐 골든브릿지까지 알찬 일정으로 꽉 채워드립니다!',
    product_tags: ['다낭', '직항', '노팁', '노옵션', '5성', '호이안', '바나힐', '신라모노그램'],
    accommodations: [{ name: '다낭 신라 모노그램', grade: 5, nights: 3, note: '5성급 리조트' }],
    price_dates: PD_BX_신라,
    itinerary_data: makeItinerary({
      hotelName: '다낭 신라 모노그램',
      hotelNote: '5성급 리조트',
      airline: 'BX 에어부산',
      flightOutCode: 'BX773',
      flightOutTime: '20:50',
      flightArrTime: '23:50',
      flightInCode: 'BX774',
      flightInTime: '00:45',
      flightRetArrTime: '07:20',
      highlightsInclusions: INCLUSIONS_신라,
    }),
    customer_notes: '전 상품 조인행사 진행될 수 있으며 현지에서 옵션 안내 함께 드립니다.',
    internal_notes: '투어비 선발 마감 2026-05-28. 조인 상품(실속+노노). 추석연휴(9/24~27) 써차지 1인 1박 3만원 별도. BX증편편(BX7315/7325 22:05→01:10)도 동일 운영.',
    raw_text: RAW_TEXT,
    raw_text_hash: RAW_TEXT_HASH,
    agent_audit_report: AGENT_AUDIT,
    confidence: 0.96,
    filename: 'manual',
    file_type: 'manual',
  },

  // ③ LJ 진에어 × 메리어트 리조트
  {
    title: '[LJ 진에어] 다낭/호이안 메리어트리조트 노팁노옵션 3박5일',
    display_title: '다낭 메리어트 3박5일',
    hero_tagline: '부산 직항 LJ진에어 · 4인+ 풀빌라 무료업그레이드',
    destination: '다낭',
    country: '베트남',
    duration: 5,
    nights: 3,
    departure_airport: '부산',
    airline: 'LJ 진에어',
    product_type: '실속+노팁노옵션',
    trip_style: ['커플', '가족', '친구'],
    min_participants: 4,
    price: 989000,
    single_supplement: 260000,
    surcharges: SURCHARGES_메리어트,
    excluded_dates: [],
    inclusions: INCLUSIONS_메리어트,
    excludes: EXCLUDES,
    notices_parsed: NOTICES_메리어트,
    product_highlights: [
      '부산 직항 LJ진에어',
      '5성 메리어트 리조트&스파 3박 (4인+ 풀빌라 무료업그레이드)',
      '기사·가이드팁 전부 포함',
      '전신마사지 2시간 포함',
      '바나힐 골든브릿지·케이블카',
    ],
    product_summary: '부산에서 LJ진에어 직항으로 날아가는 다낭 패키지예요. 메리어트 리조트&스파 5성 3박에 4인 이상 예약하면 풀빌라 무료 업그레이드까지! 기사팁·가이드팁 걱정 없이 호이안 야경 씨클로, 바나힐 골든브릿지까지 알차게 즐기고 오세요.',
    product_tags: ['다낭', '직항', '노팁', '노옵션', '5성', '호이안', '바나힐', '메리어트', '풀빌라'],
    accommodations: [{ name: '다낭 메리어트 리조트&스파', grade: 5, nights: 3, note: '5성급 리조트형 풀빌라' }],
    price_dates: PD_LJ_메리어트,
    itinerary_data: makeItinerary({
      hotelName: '다낭 메리어트 리조트&스파',
      hotelNote: '5성급 리조트형 풀빌라',
      airline: 'LJ 진에어',
      flightOutCode: 'LJ111',
      flightOutTime: '21:05',
      flightArrTime: '00:05',
      flightInCode: 'LJ112',
      flightInTime: '01:05',
      flightRetArrTime: '07:30',
      highlightsInclusions: INCLUSIONS_메리어트,
    }),
    customer_notes: '전 상품 조인행사 진행될 수 있으며 현지에서 옵션 안내 함께 드립니다. 4인 이상 예약 시 풀빌라 업그레이드는 사전 확인 필수입니다.',
    internal_notes: '투어비 선발 마감 2026-05-28. 조인 상품(실속+노노). 불꽃축제(5/30,6/6,6/13,6/20,6/27,7/11)·독립기념일(9/1~2) 써차지 1인 1박 3만원 별도.',
    raw_text: RAW_TEXT,
    raw_text_hash: RAW_TEXT_HASH,
    agent_audit_report: AGENT_AUDIT,
    confidence: 0.96,
    filename: 'manual',
    file_type: 'manual',
  },

  // ④ BX 에어부산 × 메리어트 리조트
  {
    title: '[BX 에어부산] 다낭/호이안 메리어트리조트 노팁노옵션 3박5일',
    display_title: '다낭 메리어트 3박5일',
    hero_tagline: '부산 직항 BX에어부산 · 4인+ 풀빌라 무료업그레이드',
    destination: '다낭',
    country: '베트남',
    duration: 5,
    nights: 3,
    departure_airport: '부산',
    airline: 'BX 에어부산',
    product_type: '실속+노팁노옵션',
    trip_style: ['커플', '가족', '친구'],
    min_participants: 4,
    price: 1009000,
    single_supplement: 260000,
    surcharges: SURCHARGES_메리어트,
    excluded_dates: [],
    inclusions: INCLUSIONS_메리어트,
    excludes: EXCLUDES,
    notices_parsed: NOTICES_메리어트,
    product_highlights: [
      '부산 직항 BX에어부산',
      '5성 메리어트 리조트&스파 3박 (4인+ 풀빌라 무료업그레이드)',
      '기사·가이드팁 전부 포함',
      '전신마사지 2시간 포함',
      '바나힐 골든브릿지·케이블카',
    ],
    product_summary: '부산에서 BX에어부산 직항으로 날아가는 다낭 패키지예요. 메리어트 리조트&스파 5성 3박에 4인 이상 예약하면 풀빌라 무료 업그레이드까지! 기사팁·가이드팁 걱정 없이 호이안 야경 씨클로, 바나힐 골든브릿지까지 알차게 즐기고 오세요.',
    product_tags: ['다낭', '직항', '노팁', '노옵션', '5성', '호이안', '바나힐', '메리어트', '풀빌라'],
    accommodations: [{ name: '다낭 메리어트 리조트&스파', grade: 5, nights: 3, note: '5성급 리조트형 풀빌라' }],
    price_dates: PD_BX_메리어트,
    itinerary_data: makeItinerary({
      hotelName: '다낭 메리어트 리조트&스파',
      hotelNote: '5성급 리조트형 풀빌라',
      airline: 'BX 에어부산',
      flightOutCode: 'BX773',
      flightOutTime: '20:50',
      flightArrTime: '23:50',
      flightInCode: 'BX774',
      flightInTime: '00:45',
      flightRetArrTime: '07:20',
      highlightsInclusions: INCLUSIONS_메리어트,
    }),
    customer_notes: '전 상품 조인행사 진행될 수 있으며 현지에서 옵션 안내 함께 드립니다. 4인 이상 예약 시 풀빌라 업그레이드는 사전 확인 필수입니다.',
    internal_notes: '투어비 선발 마감 2026-05-28. 조인 상품(실속+노노). 불꽃축제(5/30,6/6,6/13,6/20,6/27,7/11)·독립기념일(9/1~2) 써차지 1인 1박 3만원 별도. BX증편편(BX7315/7325 22:05→01:10)도 동일 운영.',
    raw_text: RAW_TEXT,
    raw_text_hash: RAW_TEXT_HASH,
    agent_audit_report: AGENT_AUDIT,
    confidence: 0.96,
    filename: 'manual',
    file_type: 'manual',
  },
];

// ─── 실행 ─────────────────────────────────────────────────────
(async () => {
  const inserter = createInserter({
    landOperator: '투어비',
    commissionRate: 10,
    ticketingDeadline: '2026-05-28',
    destCode: 'DAD',
  });
  await inserter.run(ALL_PACKAGES);
})();
