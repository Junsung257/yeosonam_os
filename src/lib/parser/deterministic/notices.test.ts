import { describe, it, expect } from 'vitest';
import {
  extractNotices,
  mergeNoticesParsed,
  enrichExcludesFromRemarks,
} from './notices';

const DANANG_SNIPPET = `비    고 
 * 2인실 1명이 쓰시는 경우 싱글차지 $120/인 발생합니다.
 * 베트남에서 한국인 가이드 단속이 강화되고 있어 현지인 가이드가 공항 미팅 및 샌딩을 진행합니다.
 * 4명이하 행사시 현지가이드 행사 진행될수 있습니다.
주의사항
 * 항공은 GV2 기준이며, 2인 이상 발권 후 GV깨질 시 전체 인원 취소수수료 발생하니 참고부탁드립니다.
 * 2025년 1월 1일부터 베트남 전자담배가 금지품목 대상에 포함되었습니다.
 * 여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.
 * 본 행사는 쇼핑샵이 들어 가는 패키지 일정으로 쇼핑샵 일정에 참여 하지 않을 경우 패널티 $150/인 발생합니다.

일 자
지 역
`;

describe('extractNotices — 주의사항/비고 섹션', () => {
  it('주의사항·비고 블록에서 GV2·전자담배·쇼핑패널티·싱글차지 추출', () => {
    const notices = extractNotices(DANANG_SNIPPET);
    const allText = notices.map(n => n.text).join('\n');
    expect(allText).toMatch(/GV2|GV깨질/);
    expect(allText).toMatch(/전자담배/);
    expect(allText).toMatch(/패널티.*150/);
    expect(allText).toMatch(/싱글차지.*120/);
    expect(allText).toMatch(/6개월/);
  });

  it('mergeNoticesParsed — LLM CRITICAL 1건 있어도 주의사항 라인 병합', () => {
    const llm = [{ type: 'CRITICAL', title: '필수', text: '• 여권 6개월' }];
    const det = extractNotices(DANANG_SNIPPET);
    const merged = mergeNoticesParsed(llm, det);
    const critical = merged.find(n => n.type === 'CRITICAL');
    expect(critical?.text).toMatch(/GV2/);
    expect(critical?.text).toMatch(/6개월/);
  });
});

describe('enrichExcludesFromRemarks', () => {
  it('비고 싱글차지 $120 라인을 excludes에 추가', () => {
    const out = enrichExcludesFromRemarks(['개인경비', '매너팁'], DANANG_SNIPPET);
    expect(out.some(l => /싱글차지.*120/.test(l))).toBe(true);
  });

  it('쇼핑 불참 패널티 $150 라인은 excludes(추가요금)에 넣지 않음', () => {
    const out = enrichExcludesFromRemarks(['개인경비', '매너팁'], DANANG_SNIPPET);
    expect(out.some(l => /150/.test(l) && /쇼핑|패널티/.test(l))).toBe(false);
  });
});
