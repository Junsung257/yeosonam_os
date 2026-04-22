/**
 * 블로그 3색 accent 후처리
 *
 *   1) ==text==       → <mark>text</mark>                 (하이라이트)
 *   2) 숫자+단위      → <strong class="num">…</strong>    (주황 수치)
 *   3) :::tip … :::   → <aside class="tip">…</aside>      (민트 인포박스)
 *
 * applyMarkdownAccents — 마크다운 단계 (marked.parse 전에)
 * applyHtmlAccents    — HTML 단계 (marked.parse 후, sanitize 전에)
 *
 * 색상 정의는 src/app/globals.css 의 .prose-blog 섹션.
 */

// 마크다운 단계: marked 가 파싱 전에 처리해야 할 변환
export function applyMarkdownAccents(md: string): string {
  if (!md) return md;

  let out = md;

  // 1) ==text== → <mark>…</mark>
  //    개행 포함 X, 빈 내용 X
  out = out.replace(/==([^=\n]{1,120}?)==/g, '<mark>$1</mark>');

  // 3) :::tip / :::  블록 (한 줄짜리도 지원)
  //    여러 줄 여러 블록 가능
  out = out.replace(/:::tip\s*\n([\s\S]*?)\n:::/g, (_m, body) => {
    const inner = body.trim();
    return `\n<aside class="tip">\n\n${inner}\n\n</aside>\n`;
  });
  // 짧은 한 줄 형태: :::tip 내용 :::
  out = out.replace(/:::tip\s+(.+?)\s*:::/g, (_m, body) => `<aside class="tip">${body}</aside>`);

  return out;
}

// HTML 단계: marked.parse 결과물에 숫자/단위 자동 감싸기
// 과탐지 방지: `<code>`, `<a href>`, `<pre>`, 이미지 src 속성 내부는 건드리지 않음
export function applyHtmlAccents(html: string): string {
  if (!html) return html;

  // 숫자+단위 패턴
  // - 12,000원 / 3박 / 5일 / 30% / 25℃ / 17도 / 1.5km / 90분 / 4시간 / 1,400m / $30
  const NUM_UNIT_RE = /(\b[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:원|만원|천원|만\s*원|박|일|박\s*\d*일|%|℃|도|km|m|분|시간|시|분대|년|회|명|인|층|EUR|USD|JPY|THB)|\$\s*[0-9]+(?:\.[0-9]+)?)/g;

  // HTML 태그를 건너뛰며 텍스트 노드만 변환
  const parts: string[] = [];
  let i = 0;
  const len = html.length;

  // skip 영역 탐지용 태그
  const SKIP_TAGS = ['<a ', '<code', '<pre', '<script', '<style', '<img'];

  while (i < len) {
    // 태그 시작인지 확인
    if (html[i] === '<') {
      // skip 태그면 닫힐 때까지 그대로 push
      const lower = html.substring(i, Math.min(i + 8, len)).toLowerCase();
      const skipTag = SKIP_TAGS.find(t => lower.startsWith(t));
      if (skipTag) {
        // 해당 태그의 닫는 짝을 찾는다 (단일 태그 <img>는 '>' 까지)
        const isVoid = skipTag === '<img';
        if (isVoid) {
          const end = html.indexOf('>', i);
          if (end === -1) { parts.push(html.substring(i)); break; }
          parts.push(html.substring(i, end + 1));
          i = end + 1;
          continue;
        }
        const tagName = skipTag.replace(/[<\s]/g, '');
        const closeStr = `</${tagName}>`;
        const closeIdx = html.toLowerCase().indexOf(closeStr, i);
        if (closeIdx === -1) { parts.push(html.substring(i)); break; }
        parts.push(html.substring(i, closeIdx + closeStr.length));
        i = closeIdx + closeStr.length;
        continue;
      }

      // 일반 태그: '>' 까지 그대로
      const end = html.indexOf('>', i);
      if (end === -1) { parts.push(html.substring(i)); break; }
      parts.push(html.substring(i, end + 1));
      i = end + 1;
    } else {
      // 텍스트 노드 — 다음 '<' 까지
      const nextTag = html.indexOf('<', i);
      const segment = nextTag === -1 ? html.substring(i) : html.substring(i, nextTag);
      parts.push(segment.replace(NUM_UNIT_RE, (m) => `<strong class="num">${m}</strong>`));
      i = nextTag === -1 ? len : nextTag;
    }
  }

  return parts.join('');
}
