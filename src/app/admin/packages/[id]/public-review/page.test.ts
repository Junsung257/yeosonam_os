import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/packages/[id]/public-review/page.tsx'), 'utf8');

describe('admin public package review page contract', () => {
  it('renders Korean operator labels without mojibake', () => {
    for (const label of [
      '공개 경계 리뷰',
      '원문 DB 값, 공개 스냅샷',
      '공개 판정 요약',
      '상품명 원본',
      '여행지',
      '원문 DB 값 ↔ 공개 스냅샷 문구',
      '차단 사유와 조치',
      '숨겨졌지만 남은 오염 데이터',
      'Proof 최신성',
      '실제 route text dump',
      '원문 근거 일부',
    ]) {
      expect(source).toContain(label);
    }
    expect(source).not.toMatch(/[�Ã]|(?:怨|議|湲|곗|먮|쒓|퀎|룷|덊|쒖){2}/);
  });

  it('keeps missing snapshot, quarantine, and proof tables as controlled section errors', () => {
    expect(source).toContain("safeQuery<SnapshotRow[]>('snapshots'");
    expect(source).toContain("safeQuery<QuarantineRow[]>('quarantine'");
    expect(source).toContain("safeQuery<ProofRow[]>('proofs'");
    expect(source).toContain('조회 실패');
    expect(source).toContain('route_text_dump 없음');
    expect(source).toContain('proof 기록 없음');
  });
});
