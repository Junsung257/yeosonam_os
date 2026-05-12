/**
 * Chain of Density — 2패스 밀도 강화 (환경변수 BLOG_CHAIN_OF_DENSITY=1 일 때만)
 */

import { generateBlogText } from '@/lib/blog-ai-caller';

function stripCodeFences(s: string): string {
  return s
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function maybeApplyChainOfDensity(markdown: string): Promise<string> {
  if (process.env.BLOG_CHAIN_OF_DENSITY !== '1' || markdown.length < 500) return markdown;

  const prompt = `아래는 한국어 여행 블로그 초안(마크다운)이다.
다음만 수행하라:
- 군더더기·중복 수식을 줄여 정보 밀도를 높인다.
- 사실·숫자·고유명사·H1/H2 구조는 유지한다.
- 새로운 사실을 만들지 마라.
- 출력은 마크다운 본문만 (코드펜스 금지).

--- 초안 ---
${markdown.slice(0, 14000)}`;

  try {
    const out = stripCodeFences(await generateBlogText(prompt, { temperature: 0.35, maxTokens: 8192 }));
    return out.length > markdown.length * 0.5 ? out : markdown;
  } catch {
    return markdown;
  }
}
