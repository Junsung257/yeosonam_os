import { describe, expect, it } from 'vitest';
import { extractAttractionCandidates } from './itinerary-attraction-candidates';

describe('extractAttractionCandidates', () => {
  it('이동/관광 혼합 라인에서 관광지 키만 분리', () => {
    const c = extractAttractionCandidates(
      '▶도이인타논으로 이동 [1시간 소요]',
      '태국에서 가장 높은 해발 2656미터의 히말라야의 관문 도이인타논 산',
    );
    expect(c.some(x => x.includes('도이인타논'))).toBe(true);
  });

  it('복수 명소 구분자를 분리', () => {
    const c = extractAttractionCandidates('▶베치라탄 폭포 및 앙카트레일, 몽족시장관광');
    expect(c).toEqual(expect.arrayContaining(['베치라탄 폭포', '앙카트레일', '몽족시장']));
  });

  it('식사/투숙 라인은 제외', () => {
    const c = extractAttractionCandidates('석식 후 호텔 투숙 및 휴식');
    expect(c.length).toBe(0);
  });

  it('괄호 안 별칭도 별도 후보로 추출', () => {
    const c = extractAttractionCandidates('▶린푸억사원(달랏 핑크 사원) 관광');
    expect(c).toEqual(expect.arrayContaining(['린푸억사원', '달랏 핑크 사원']));
  });

  it('60자 까지 긴 정식 명칭 흡수', () => {
    const c = extractAttractionCandidates('▶도멘 드 마리 성당 (Domaine de Marie Catholic Church)');
    expect(c.some(x => x.includes('도멘 드 마리 성당'))).toBe(true);
  });

  it('"X 후 Y" 패턴 분리 (2026-05-15)', () => {
    const c = extractAttractionCandidates('▶도이인타논 후 몽족시장');
    expect(c).toEqual(expect.arrayContaining(['도이인타논', '몽족시장']));
  });

  it('"→" / "거쳐" 패턴 분리', () => {
    const c = extractAttractionCandidates('▶다딴라폭포 → 랑비앙산');
    expect(c).toEqual(expect.arrayContaining(['다딴라폭포', '랑비앙산']));
  });

  // ── 사고 #2026-05-15-KWL 회귀 fixture (GEPA pattern) ──
  it('[ERR-KWL] 일반어 단독 시드 차단 — "맛집/카페/옷가게..." → 정확한 핵심만', () => {
    // 사장님 계림 사고 원문 그대로
    const c = extractAttractionCandidates('▶맛집/카페/옷가게가 즐비한 계림의 명동 동서항');
    expect(c).not.toContain('맛집');
    expect(c).not.toContain('카페');
    expect(c).not.toContain('옷가게');
    expect(c).not.toContain('명동');
    // "동서항" 또는 그 변형이 추출되어야 (긴 토큰이라 부분 추출 OK)
    expect(c.some(x => x.includes('동서항'))).toBe(true);
  });

  it('[ERR-KWL] STANDALONE_STOP_WORDS 핵심 케이스 차단', () => {
    const c = extractAttractionCandidates('▶맛집, 카페, 시장, 거리, 박물관, 사원');
    // 모든 일반어 단독 차단
    expect(c).not.toContain('맛집');
    expect(c).not.toContain('카페');
    expect(c).not.toContain('시장');
    expect(c).not.toContain('거리');
    expect(c).not.toContain('박물관');
    expect(c).not.toContain('사원');
  });

  it('[ERR-KWL] "여행의 피로를 풀어주는 발마사지 체험" — 핵심 추출', () => {
    // (60분/팁포함) 같은 괄호 안 부속 정보는 cleanToken 으로 제거
    const c = extractAttractionCandidates('▶여행의 피로를 풀어주는 발마사지 체험(60분/팁포함)');
    // "발마사지" 가 cleanToken 후에도 살아남으려면 STOP_WORDS 차단되면 안 됨
    //   "마사지" 는 STOP_WORDS 에 있지만 "발마사지" 는 4자 + 비-stop word
    expect(c.length).toBeGreaterThanOrEqual(1);
  });
});
