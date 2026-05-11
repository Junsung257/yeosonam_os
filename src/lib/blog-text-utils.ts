/**
 * Blog text utilities — 블로그 본문 텍스트 전처리 SSOT.
 *
 * 이전에는 stripMarkup 이 blog-quality-gate.ts 와 blog-readability.ts 양쪽에
 * 거의 동일하게 복제되어 있었음. 한쪽만 수정하면 다른 쪽 점수가 어긋나
 * 게이트 결과가 분기되는 위험이 있어 이 파일로 통합.
 *
 * 차이 보존 옵션:
 *   - stripTablePipes: 마크다운 테이블 파이프('|')도 공백 처리 (readability 전용)
 *   - collapseWhitespace: 연속 공백을 하나로 축약 (quality-gate 기본 true,
 *     readability 는 false — '\n+' 로 문장 분리하기 때문)
 */

export interface StripMarkupOptions {
  stripTablePipes?: boolean;
  collapseWhitespace?: boolean;
}

export function stripMarkup(raw: string, opts: StripMarkupOptions = {}): string {
  const { stripTablePipes = false, collapseWhitespace = true } = opts;
  let out = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/#{1,6}\s+/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '$1');
  if (stripTablePipes) out = out.replace(/\|/g, ' ');
  if (collapseWhitespace) out = out.replace(/\s+/g, ' ');
  return out.trim();
}
