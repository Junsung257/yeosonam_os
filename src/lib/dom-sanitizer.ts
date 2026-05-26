/**
 * @file dom-sanitizer.ts
 * @description 전역 HTML sanitizer — XSS 방어 중앙집중화
 *
 * isomorphic-dompurify 기반으로 서버/클라이언트 모두에서 동작.
 * DOMPurify.sanitize()를 직접 import 하던 9개 파일을 이 유틸로 통일.
 *
 * 사용:
 *   import { sanitizeHtml } from '@/lib/dom-sanitizer';
 *   <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(userContent) }} />
 *
 * 왜 필요한가:
 *   - isomorphic-dompurify vs dompurify 혼용으로 서버/클라이언트 import 실수 방지
 *   - config 일괄 변경 가능 (예: ADD_TAGS, FORBID_TAGS)
 *   - 'use client' 컴포넌트에서 서버 import 시 window is not defined 방지
 */
import DOMPurify from 'isomorphic-dompurify';

export interface SanitizeOptions {
  /** 허용할 추가 태그 (예: ['mark', 'ins']) */
  ADD_TAGS?: string[];
  /** 허용할 추가 속성 (예: ['class']) */
  ADD_ATTR?: string[];
  /** 금지할 태그 (기본값: 스크립트/이벤트 핸들러) */
  FORBID_TAGS?: string[];
  /** FORBID_ATTR 로 대체됨 */
  FORBID_ATTR?: string[];
  /** true면 태그를 제거하지 않고 이스케이프 */
  WHOLE_DOCUMENT?: boolean;
}

const DEFAULT_OPTIONS: SanitizeOptions = {
  ADD_TAGS: ['mark', 'ins', 'del'],
  ADD_ATTR: ['class', 'target', 'rel'],
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
};

/**
 * HTML 문자열을 안전하게 sanitize.
 * @param html - 정제할 HTML
 * @param options - DOMPurify 옵션 오버라이드
 * @returns XSS-safe HTML 문자열
 */
export function sanitizeHtml(html: string, options?: SanitizeOptions): string {
  if (!html) return '';
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return DOMPurify.sanitize(html, opts);
}

/**
 * 마크다운 렌더 결과 HTML을 sanitize (blog/컨텐츠 용).
 * 기본 설정과 같지만 긴 본문에 최적화.
 */
export function sanitizeBlogHtml(html: string): string {
  return sanitizeHtml(html, {
    ADD_TAGS: ['mark', 'ins', 'del', 'aside', 'figure', 'figcaption'],
    ADD_ATTR: ['class', 'target', 'rel', 'data-tldr', 'data-ai-overview'],
  });
}

/**
 * 사용자 입력 텍스트를 HTML 이스케이프 (태그를 문자로 표시).
 * dangerouslySetInnerHTML 없이 안전하게 텍스트를 표시할 때 사용.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
