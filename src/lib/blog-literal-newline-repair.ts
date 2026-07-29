export interface BlogLiteralNewlineRepair {
  markdown: string;
  changed: boolean;
  replacementCount: number;
}

export function repairBlogLiteralNewlines(markdown: string): BlogLiteralNewlineRepair {
  let replacementCount = 0;
  const repaired = markdown.replace(/\\+(?:r\\+)?n/g, () => {
    replacementCount += 1;
    return '\n';
  });
  return {
    markdown: repaired,
    changed: replacementCount > 0,
    replacementCount,
  };
}
