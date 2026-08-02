import { describe, expect, it } from 'vitest';

import {
  destinationMediaApprovalMissingEvidence,
  isDestinationMediaApprovalReady,
} from './destination-media-approval';

describe('destination media approval readiness', () => {
  const commons = {
    hero_image_url: 'https://example.supabase.co/reviewed.jpg',
    hero_image_provider: 'wikimedia_commons',
    hero_image_pexels_id: null,
    hero_image_source_page_url: 'https://commons.wikimedia.org/wiki/File:Reviewed.jpg',
    hero_image_source_file_title: 'File:Reviewed.jpg',
    hero_image_license: 'CC BY-SA 4.0',
    hero_image_license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    hero_photographer: 'Example Author',
  };

  it('requires the complete Commons attribution and license packet', () => {
    expect(isDestinationMediaApprovalReady(commons)).toBe(true);
    expect(destinationMediaApprovalMissingEvidence({
      ...commons,
      hero_image_license_url: null,
      hero_image_source_file_title: null,
    })).toEqual(['원본 파일명', '라이선스 원문']);
  });

  it('requires a Pexels asset ID but not Commons-only file fields', () => {
    expect(isDestinationMediaApprovalReady({
      ...commons,
      hero_image_provider: 'pexels',
      hero_image_pexels_id: 123,
      hero_image_source_file_title: null,
      hero_image_license: 'Pexels License',
      hero_image_license_url: 'https://www.pexels.com/license/',
      hero_image_source_page_url: 'https://www.pexels.com/photo/123/',
    })).toBe(true);
    expect(destinationMediaApprovalMissingEvidence({
      ...commons,
      hero_image_provider: 'pexels',
      hero_image_pexels_id: null,
    })).toContain('Pexels 자산 ID');
  });

  it('never treats an unknown provider or incomplete base evidence as approvable', () => {
    expect(destinationMediaApprovalMissingEvidence({
      hero_image_url: null,
      hero_image_provider: 'unknown',
      hero_image_source_page_url: null,
      hero_photographer: null,
    })).toEqual([
      '저장 이미지',
      '원본 페이지',
      '저작자·권리자',
      '허용된 공급자',
    ]);
  });
});
