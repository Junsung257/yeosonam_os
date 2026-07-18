import { describe, expect, it } from 'vitest';
import { selectActiveBlogPrompt } from './blog-prompt-selection';

describe('blog prompt selection', () => {
  const repositoryPrompt = {
    repositoryContent: 'repository v1.5 prompt',
    repositoryVersion: 'v1.5',
  };

  it('uses the repository prompt when the active database prompt is stale', () => {
    expect(selectActiveBlogPrompt({
      ...repositoryPrompt,
      databaseContent: 'old v1.0 prompt',
      databaseVersion: 'v1.0',
    })).toEqual({
      content: 'repository v1.5 prompt',
      version: 'v1.5',
      source: 'repository_fallback',
    });
  });

  it('keeps a database prompt that is at least as new as the repository contract', () => {
    expect(selectActiveBlogPrompt({
      ...repositoryPrompt,
      databaseContent: 'reviewed v2 prompt',
      databaseVersion: 'v2.0',
    })).toEqual({
      content: 'reviewed v2 prompt',
      version: 'v2.0',
      source: 'database',
    });
  });

  it('fails safely to the repository prompt for empty or malformed database rows', () => {
    expect(selectActiveBlogPrompt({
      ...repositoryPrompt,
      databaseContent: '',
      databaseVersion: 'latest',
    }).source).toBe('repository_fallback');
  });
});
