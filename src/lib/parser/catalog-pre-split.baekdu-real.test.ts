import { describe, expect, it } from 'vitest';
import {
  collectVariantCatalogBlockStarts,
  countCatalogItineraryHeaders,
  splitCatalogByItineraryHeaders,
} from './catalog-pre-split';

describe('real Korean Baekdu grade catalog split', () => {
  const realBaekduCatalog = `6/11(목) 까지 항공권 발권조건 2명부터 출발확정
출발일
패턴
세이브
스탠다드
프리미엄
크라운
6월 1~20 월 3박4일 759,000 999,000 1,179,000 1,229,000

세이브
실속

연길/백두산(북파) 2박3일

포 함 내 역
왕복 항공료 및 텍스, 유류할증료(6월기준), 호텔(2인1실), 차량, 가이드
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하

스탠다드
품격 노노

연길/백두산 (북파) 2박3일

포 함 내 역
왕복 항공료 및 텍스, 기사/가이드 경비, 특식2회
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하

프리미엄노노노

연길/백두산 (북파) 2박3일

포 함 내 역
왕복 항공료 및 텍스, 특급호텔숙박+온천욕, 리무진차량
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하

크라운
노노노+

연길/백두산 (북파) 2박3일

포 함 내 역
왕복 항공료 및 텍스, 5D비행체험, 리무진차량
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하

세이브
실속

연길/백두산(북+서파) 3박4일

포 함 내 역
왕복 항공료 및 텍스, 호텔, 차량, 가이드
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하

스탠다드
품격 노노

연길/백두산(북+서파) 3박4일

포 함 내 역
왕복 항공료 및 텍스, 특식3회
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하

프리미엄노노노

연길/백두산(북+서파) 3박4일

포 함 내 역
왕복 항공료 및 텍스, 특식6회, 리무진차량
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하

크라운
노노노+

연길/백두산(북+서파) 3박4일

포 함 내 역
왕복 항공료 및 텍스, 특식6회, 리무진차량
일 자
지 역
교통편
시 간
일 정
식 사
제1일
부산
연길
이도백하`;

  it('detects eight real Korean grade/course blocks', () => {
    expect(collectVariantCatalogBlockStarts(realBaekduCatalog)).toHaveLength(8);
    expect(countCatalogItineraryHeaders(realBaekduCatalog)).toBe(8);
  });

  it('splits each grade/course into one customer-facing product section', () => {
    const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(realBaekduCatalog);
    expect(sharedPrefix).toContain('6/11(목)');
    expect(sections).toHaveLength(8);
    expect(sections[0]).toContain('세이브');
    expect(sections[0]).toContain('북파) 2박3일');
    expect(sections[1]).toContain('특식2회');
    expect(sections[3]).toContain('5D비행체험');
    expect(sections[4]).toContain('북+서파) 3박4일');
    expect(sections[7]).toContain('크라운');
  });
});
