export type BlogPromptSource = 'database' | 'repository_fallback';

export interface SelectedBlogPrompt {
  content: string;
  version: string;
  source: BlogPromptSource;
}

function parsePromptVersion(value: string | null | undefined): number[] | null {
  const match = value?.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function comparePromptVersions(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function selectActiveBlogPrompt(input: {
  databaseContent?: string | null;
  databaseVersion?: string | null;
  repositoryContent: string;
  repositoryVersion: string;
  databaseContentValidator?: (content: string) => boolean;
}): SelectedBlogPrompt {
  const databaseContent = input.databaseContent?.trim() ?? '';
  const databaseVersion = parsePromptVersion(input.databaseVersion);
  const repositoryVersion = parsePromptVersion(input.repositoryVersion);
  const databaseIsCurrent = Boolean(
    databaseContent
    && databaseVersion
    && repositoryVersion
    && comparePromptVersions(databaseVersion, repositoryVersion) >= 0
    && (!input.databaseContentValidator || input.databaseContentValidator(databaseContent)),
  );

  if (databaseIsCurrent) {
    return {
      content: databaseContent,
      version: input.databaseVersion!.trim(),
      source: 'database',
    };
  }

  return {
    content: input.repositoryContent,
    version: input.repositoryVersion,
    source: 'repository_fallback',
  };
}
