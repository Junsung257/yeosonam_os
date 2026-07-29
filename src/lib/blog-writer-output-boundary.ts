export const BLOG_WRITER_MAX_POSTPROCESS_CHARACTERS = 16_000;

export interface BlogWriterOutputBoundary {
  markdown: string;
  originalCharacters: number;
  finalCharacters: number;
  truncated: boolean;
}

export function boundBlogWriterOutput(
  markdown: string,
  maxCharacters = BLOG_WRITER_MAX_POSTPROCESS_CHARACTERS,
): BlogWriterOutputBoundary {
  const originalCharacters = markdown.length;
  if (originalCharacters <= maxCharacters) {
    return {
      markdown,
      originalCharacters,
      finalCharacters: originalCharacters,
      truncated: false,
    };
  }

  const prefix = markdown.slice(0, maxCharacters);
  const paragraphBoundary = prefix.lastIndexOf('\n\n');
  const safeCutoff = paragraphBoundary >= Math.floor(maxCharacters * 0.75)
    ? paragraphBoundary
    : maxCharacters;
  const bounded = prefix.slice(0, safeCutoff).trimEnd();

  return {
    markdown: bounded,
    originalCharacters,
    finalCharacters: bounded.length,
    truncated: true,
  };
}
