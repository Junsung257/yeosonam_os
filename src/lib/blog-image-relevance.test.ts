import { describe, expect, it } from 'vitest';
import type { PexelsPhoto } from './pexels';
import {
  buildBlogImageSearchQuery,
  scorePexelsPhotoRelevance,
  selectRelevantPexelsPhoto,
} from './blog-image-relevance';

function photo(id: number, alt: string): PexelsPhoto {
  return {
    id,
    width: 1200,
    height: 627,
    alt,
    url: `https://pexels.com/photo/${id}`,
    photographer: 'tester',
    photographer_url: 'https://pexels.com/tester',
    src: {
      original: `https://images.pexels.com/${id}/original.jpg`,
      large2x: '', large: '', medium: '', small: '', portrait: '',
      landscape: `https://images.pexels.com/${id}/landscape.jpg`,
      tiny: '',
    },
  };
}

describe('blog image relevance', () => {
  it('builds a destination-and-intent-specific query', () => {
    expect(buildBlogImageSearchQuery({
      destinationQuery: 'Sapporo Japan winter',
      primaryKeyword: '삿포로 식비',
      sectionTitle: '하루 식사 예산',
    })).toBe('Sapporo Japan winter local cuisine restaurant dishes street food');
  });

  it('penalizes a coastal mismatch for an inland city', () => {
    const wrong = photo(1, 'Ocean beach and tropical waves');
    const right = photo(2, 'Guangzhou Canton Tower city skyline on a cloudy day');
    const context = {
      destinationQuery: 'Guangzhou China Canton Tower city skyline',
      primaryKeyword: '광저우 월별 날씨',
      sectionTitle: '월별 날씨와 옷차림',
    };

    expect(scorePexelsPhotoRelevance(right, context)).toBeGreaterThan(
      scorePexelsPhotoRelevance(wrong, context),
    );
    expect(selectRelevantPexelsPhoto([wrong, right], context)?.id).toBe(2);
  });

  it('returns null instead of relabeling an unrelated photo as relevant', () => {
    expect(selectRelevantPexelsPhoto(
      [photo(3, 'Abstract white studio wall texture')],
      {
        destinationQuery: 'Guangzhou China Canton Tower city skyline',
        primaryKeyword: '광저우 월별 날씨',
        sectionTitle: '월별 날씨와 옷차림',
      },
    )).toBeNull();
  });
});
