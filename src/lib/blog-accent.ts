/**
 * 블로그 3색 accent 후처리
 *
 *   1) ==text==       → <mark>text</mark>                 (주황 형광펜)
 *   2) 숫자+단위      → <strong class="num">…</strong>    (주황 수치)
 *   3) :::tip … :::   → <aside class="tip">…</aside>      (민트 인포박스)
 *
 * applyMarkdownAccents — 마크다운 단계 (marked.parse 전에)
 * applyHtmlAccents    — HTML 단계 (marked.parse 후, sanitize 전에)
 *
 * 색상 정의는 src/app/globals.css 의 .prose-blog 섹션.
 */

/**
 * 단일 틸드(`~`)를 en-dash(`–`)로 전면 정규화 (정상 `~~text~~` strikethrough 만 보호).
 *
 * marked.js GFM strikethrough 의 실제 구현 정규식은 `~+(?=\S)([\s\S]*?\S)~+` —
 * 명세는 `~~` 두 개를 요구하지만 구현은 단일 `~` 페어도 통째로 strikethrough 로 잡아먹는다.
 * 한국 출판 관습상 `~` 는 범위 표기(25~32℃, 30분~1시간, 평일(화~목), 오전 9~11시 등)에
 * 광범위하게 쓰이기 때문에 좁은 패턴(숫자~숫자)만 잡아서는 부족 — 본문 곳곳 strikethrough 폭주가 남는다.
 * (실측 2026-05-17: 본문 1편에 단일 `~` 14개, 그중 5쌍이 `<del>` 으로 묶임)
 *
 * 해결: code span(` ` `)·코드블록(``` ```)을 제외한 모든 단일 `~` 를 `–` (en-dash) 로 치환.
 * `~~` 는 임시 sentinel 로 보호 후 복원 — 정상 strikethrough markdown 살림.
 */
export function normalizeRangeDashes(md: string): string {
  if (!md) return md;

  // 1) `~~` 보호 — 정상 strikethrough markdown 살림
  const DBLTILDE = 'DBLTILDE';
  let out = md.replace(/~~/g, DBLTILDE);

  // 2) code span / fenced code 보호 — 사용자 의도된 `~` (예: `~/.bashrc`) 살림
  const codeChunks: string[] = [];
  out = out.replace(/```[\s\S]*?```/g, (m) => {
    codeChunks.push(m);
    return `CB${codeChunks.length - 1}`;
  });
  out = out.replace(/`[^`\n]+`/g, (m) => {
    codeChunks.push(m);
    return `CB${codeChunks.length - 1}`;
  });

  // 3) 남은 모든 단일 `~` → en-dash (한글/숫자/공백 어디서든 동작)
  out = out.replace(/~/g, '–');

  // 4) code 복원 + ~~ 복원
  out = out.replace(/CB(\d+)/g, (_m, n) => codeChunks[Number(n)] || '');
  out = out.replace(new RegExp(DBLTILDE, 'g'), '~~');
  return out;
}

// 마크다운 단계: marked 가 파싱 전에 처리해야 할 변환
export function applyMarkdownAccents(md: string): string {
  if (!md) return md;

  // 0) 범위 표기 정규화 (strikethrough 폭주 방지) — 가장 먼저 적용
  let out = normalizeRangeDashes(md);

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

  /**
   * 숫자+단위 + **범위(`A–B단위`)** 패턴
   *
   * - 단독: 12,000원 / 3박 / 5일 / 30% / 25℃ / 1.5km / 90분 / $30
   * - 범위: 25–32℃, 30분–1시간, 2–5시, 0.5–1m, 12–5월  ← **range 통째 wrap (start 검정 + 단위만 주황 분리 사고 차단, 2026-05-17)**
   *
   * `m(?![a-zA-Z가-힣])` lookahead — `200mm` 의 첫 `m` 단독 매치 차단 (mm 단위는 alternation 우선 매치).
   * alternation 순서: longest unit first (만원>원, mm>m, 분대>분).
   */
  // `m(?![a-zA-Z])` — 영문자만 차단 (`200mm` 의 첫 `m` 단독 매치 방지). 한글(`1m로`, `500m와`)은 정상.
  const UNIT_SRC = '만원|천원|만\\s*원|원|박\\s*\\d*일|박|일|km|mm|cm|m(?![a-zA-Z])|℃|도|%|분대|분|시간|시|년|월|주|회|배|잔|명|인|층|EUR|USD|JPY|THB';
  const NUM = '\\d[\\d,]*(?:\\.\\d+)?';
  const RANGE = `${NUM}\\s*(?:${UNIT_SRC})?\\s*–\\s*${NUM}\\s*(?:${UNIT_SRC})`;
  const SINGLE = `\\b${NUM}\\s*(?:${UNIT_SRC})|\\$\\s*\\d+(?:\\.\\d+)?`;
  const NUM_UNIT_RE = new RegExp(`(${RANGE}|${SINGLE})`, 'g');

  // HTML 태그를 건너뛰며 텍스트 노드만 변환
  const parts: string[] = [];
  let i = 0;
  const len = html.length;

  // skip 영역 탐지용 태그 — `<strong` 추가 (이미 wrap 된 .num 안에서 중첩 매치 방지)
  const SKIP_TAGS = ['<a ', '<code', '<pre', '<script', '<style', '<img', '<strong'];

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
