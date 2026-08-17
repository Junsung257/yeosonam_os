import { describe, expect, it } from 'vitest';
import {
  belongsToBlogReplacementLineage,
  readBlogReplacementTargetCreativeId,
} from './blog-corpus-lineage-v3';

describe('blog corpus replacement lineage V3', () => {
  const target = '812343df-82d7-442b-8cfb-c25dd161ba0a';

  it('recognizes the published target and retained review shadows for the same canonical refresh', () => {
    expect(belongsToBlogReplacementLineage({ id: target, replacementTargetCreativeId: target })).toBe(true);
    expect(belongsToBlogReplacementLineage({
      id: 'shadow-draft',
      replacementTargetCreativeId: target,
      meta: {
        reviewed_published_replacement: { target_creative_id: target },
      },
    })).toBe(true);
    expect(readBlogReplacementTargetCreativeId({
      private_regeneration: { replaced_creative_id: target },
    })).toBe(target);
  });

  it('keeps unrelated drafts and queue candidates in the diversity corpus', () => {
    expect(belongsToBlogReplacementLineage({
      id: 'unrelated-draft',
      replacementTargetCreativeId: target,
      meta: {
        automated_published_replacement: { target_creative_id: 'different-target' },
      },
    })).toBe(false);
    expect(belongsToBlogReplacementLineage({
      id: 'ordinary-draft',
      replacementTargetCreativeId: target,
      meta: null,
    })).toBe(false);
  });
});
