import { describe, expect, it } from 'vitest';
import { terminalNonMasterReason } from '../../src/lib/itinerary-entity-resolution-engine';

describe('terminalNonMasterReason attraction fragment gate', () => {
  it('rejects table headers and operational fragments before customer-visible attraction review', () => {
    expect(terminalNonMasterReason('attraction', '출 발 일 자', '출 발 일 자')).toBe(
      'operational or non-attraction schedule fragment',
    );
    expect(terminalNonMasterReason('attraction', '이도백화', '이도백화')).toBe(
      'city or route token, not attraction master',
    );
    expect(terminalNonMasterReason('attraction', '임주', '임주')).toBe(
      'city or route token, not attraction master',
    );
    expect(terminalNonMasterReason('attraction', '카와구치', '카와구치')).toBe(
      'city or route token, not attraction master',
    );
  });

  it('rejects food, drink, and cafe fragments that should not become attraction masters', () => {
    expect(terminalNonMasterReason('attraction', '화이트로즈', '화이트로즈')).toBe(
      'activity, meal, or service detail, not an attraction master',
    );
    expect(terminalNonMasterReason('attraction', '랭ㅤㅆㅔㅂ', '랭ㅤㅆㅔㅂ')).toBe(
      'activity, meal, or service detail, not an attraction master',
    );
    expect(terminalNonMasterReason('attraction', '그랜드 월드를 한 눈에 볼 수 있는 I AM COFFEE', '그랜드 월드를 한 눈에 볼 수 있는 I AM COFFEE')).toBe(
      'activity, meal, or service detail, not an attraction master',
    );
  });

  it('rejects current backlog schedule fragments that are not attraction masters', () => {
    for (const label of [
      '왕복 40분 소요',
      '이루어집니다.',
      '4륜 오토바이',
      '나트랑 야간',
      '천지 조망',
      '썬월드 내 자유',
      '테를지 현대식 캠프',
      '낮과 밤이 다른 호이안 야간',
      '다낭 야간',
      '계림 시내',
      '나트랑 시내',
      '비에이ㆍ오타루ㆍ도야ㆍ노보리베츠',
      '영해CC 18홀 라운딩',
      '써핑카트',
      '엘승타사르 현대식 캠프',
      '60여마리의 말과 사람이 함께하는 대형 마상쇼',
    ]) {
      expect(terminalNonMasterReason('attraction', label, label)).toBe(
        'generic, itinerary, or attribute fragment, not attraction master',
      );
    }
  });

  it('rejects readable Korean backlog fragments that are not attraction masters', () => {
    for (const label of [
      '\uD638\uD551\uC2E0\uCCAD\uC2DC',
      '\uC774\uB860 \uAD50\uC721',
      '\uD55C\uC57D\uBC29 \uC911 2\uD68C',
      '\uCC9C\uC800\uC6B0 \uC2DC\uB0B4',
    ]) {
      expect(terminalNonMasterReason('attraction', label, label)).toBe(
        'generic, itinerary, or attribute fragment, not attraction master',
      );
    }

    for (const label of [
      '\uC911\uAD6D \uC120\uC885\uC744 \uB300\uD45C\uD558\uB294 \uCC9C\uB144\uACE0\uCC30',
      '\uCE6D\uB2E4\uC624\uC5D0\uC11C \uB9CC\uB098\uB294 \uC791\uC740 \uC720\uB7FD',
      '\uBE5B\uC73C\uB85C \uBB3C\uB4E0 \uACC4\uB9BC\uC758 \uBC24',
      '\uC0B0\uCC45\uB85C\uB97C \uB530\uB77C \uC790\uC720\uB86D\uAC8C \uB3D9\uBB3C\uC6D0',
      '\uC0BC\uD310\uBC30\uB97C \uD0C0\uACE0 \uAE30\uC554\uAD34\uC11D \uC0AC\uC774 \uC218\uB85C\uB97C \uC9C0\uB098\uBA70 \uC790\uC5F0\uACBD\uAD00',
    ]) {
      expect(terminalNonMasterReason('attraction', label, label)).toBe(
        'descriptive itinerary phrase, not an attraction master',
      );
    }
  });

  it('keeps plausible real attractions review-gated instead of auto-rejecting them', () => {
    expect(terminalNonMasterReason('attraction', '대소사', '대소사')).toBeNull();
    expect(terminalNonMasterReason('attraction', '사오비치', '사오비치')).toBeNull();
    expect(terminalNonMasterReason('attraction', '링응사', '링응사')).toBeNull();
    expect(terminalNonMasterReason('attraction', '깟깟마을', '깟깟마을')).toBeNull();
    expect(terminalNonMasterReason('attraction', '동강호풍경구', '동강호풍경구')).toBeNull();
    expect(terminalNonMasterReason('attraction', '볼거리 가득한 소나시 야시장', '볼거리 가득한 소나시 야시장 투어 망고주스 1잔 제공')).toBeNull();
  });
});
