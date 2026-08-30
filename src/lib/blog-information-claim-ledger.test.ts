import { describe, expect, it } from 'vitest';
import {
  BLOG_INFORMATION_CLAIM_LEDGER_MAX_ENTRIES,
  buildBlogInformationClaimLedgerPromptContract,
  parseBlogInformationWriterOutput,
  restoreApprovedRewriteClaimLabels,
} from './blog-information-claim-ledger';

describe('blog information writer claim ledger', () => {
  it('restores only an exact label-stripped approved rewrite claim', () => {
    const parsed = parseBlogInformationWriterOutput([
      'House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.',
      '<!-- INFORMATION_CLAIM_LEDGER_START',
      '{"claims":[{"claim_text":"House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.","claim_type":"price","risk_level":"MEDIUM"}]}',
      'INFORMATION_CLAIM_LEDGER_END -->',
    ].join('\n'));

    const repaired = restoreApprovedRewriteClaimLabels(parsed, [{
      claimText: '[절약형 하루 예산] [간식] House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.',
      claimType: 'price',
      riskLevel: 'MEDIUM',
    }]);

    expect(repaired.markdown).toContain(
      '[절약형 하루 예산] [간식] House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.',
    );
    expect(repaired.claimLedger[0]).toMatchObject({
      claimText: '[절약형 하루 예산] [간식] House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.',
      claimType: 'price',
      riskLevel: 'MEDIUM',
    });
  });

  it('does not repair a paraphrased rewrite claim', () => {
    const output = {
      markdown: 'House of Chin Fe 커피 가격은 2.50 USD이다.',
      claimLedger: [],
      ledgerIssues: [],
    };
    expect(restoreApprovedRewriteClaimLabels(output, [{
      claimText: '[간식] House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.',
      claimType: 'price',
      riskLevel: 'MEDIUM',
    }])).toEqual(output);
  });

  it('canonicalizes an exact approved claim when the model weakens its ledger label', () => {
    const claimText = 'GRTA Route 14의 1회 승차 요금은 1.50 USD입니다.';
    const output = {
      markdown: claimText,
      claimLedger: [{
        claimFingerprint: 'model-fingerprint',
        claimText,
        claimType: 'factual' as const,
        riskLevel: 'LOW' as const,
      }],
      ledgerIssues: [],
    };

    const repaired = restoreApprovedRewriteClaimLabels(output, [{
      claimText,
      claimType: 'price',
      riskLevel: 'MEDIUM',
    }]);

    expect(repaired.claimLedger[0]).toMatchObject({
      claimText,
      claimType: 'price',
      riskLevel: 'MEDIUM',
    });
    expect(repaired.claimLedger[0]?.claimFingerprint).not.toBe('model-fingerprint');
  });

  it('parses and removes a valid hidden ledger from the reader-visible article', () => {
    const output = parseBlogInformationWriterOutput([
      '# 공항 이동',
      '',
      '공항에서 시내까지 거리는 42km입니다.',
      '',
      '<!-- INFORMATION_CLAIM_LEDGER_START',
      '{"claims":[{"claim_text":"공항에서 시내까지 거리는 42km입니다.","claim_type":"factual","risk_level":"MEDIUM"}]}',
      'INFORMATION_CLAIM_LEDGER_END -->',
    ].join('\n'));

    expect(output.markdown).toContain('거리는 42km입니다.');
    expect(output.markdown).not.toContain('INFORMATION_CLAIM_LEDGER');
    expect(output.claimLedger).toEqual([
      expect.objectContaining({
        claimText: '공항에서 시내까지 거리는 42km입니다.',
        claimType: 'factual',
        riskLevel: 'MEDIUM',
      }),
    ]);
    expect(output.ledgerIssues).toEqual([]);
  });

  it('fails closed for missing, invalid JSON, invalid entries, and excessive ledgers', () => {
    expect(parseBlogInformationWriterOutput('일반 본문').ledgerIssues)
      .toContain('claim_ledger_missing');
    const missingEnd = parseBlogInformationWriterOutput([
      '공개 본문',
      '<!-- INFORMATION_CLAIM_LEDGER_START',
      '{"claims":[]}',
    ].join('\n'));
    expect(missingEnd.ledgerIssues).toContain('claim_ledger_missing_end_marker');
    expect(missingEnd.markdown).toBe('공개 본문');
    expect(parseBlogInformationWriterOutput([
      '본문',
      '<!-- INFORMATION_CLAIM_LEDGER_START',
      '{not-json}',
      'INFORMATION_CLAIM_LEDGER_END -->',
    ].join('\n')).ledgerIssues).toContain('claim_ledger_invalid_json');
    expect(parseBlogInformationWriterOutput([
      '본문',
      '<!-- INFORMATION_CLAIM_LEDGER_START',
      '{"claims":[{"claim_text":"값은 1입니다.","claim_type":"unknown","risk_level":"LOW"}]}',
      'INFORMATION_CLAIM_LEDGER_END -->',
    ].join('\n')).ledgerIssues).toContain('claim_ledger_entry_invalid:0');

    const tooMany = Array.from({ length: BLOG_INFORMATION_CLAIM_LEDGER_MAX_ENTRIES + 1 }, () => ({}));
    expect(parseBlogInformationWriterOutput([
      '본문',
      '<!-- INFORMATION_CLAIM_LEDGER_START',
      JSON.stringify({ claims: tooMany }),
      'INFORMATION_CLAIM_LEDGER_END -->',
    ].join('\n')).ledgerIssues).toContain('claim_ledger_invalid_shape');
  });

  it('publishes an explicit bounded writer contract for every factual candidate surface', () => {
    const prompt = buildBlogInformationClaimLedgerPromptContract();

    expect(prompt).toContain('body paragraphs, lists, tables, and FAQ answers');
    expect(prompt).toContain('money, percentages, distance, schedules/hours');
    expect(prompt).toContain('{"claims":[]}');
    expect(prompt).toContain('INFORMATION_CLAIM_LEDGER_START');
  });
});
