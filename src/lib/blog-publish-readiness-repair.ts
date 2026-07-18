import { buildStandardBlogCtaMarkdown } from './blog-cta';
import { stripMarkup } from './blog-text-utils';

export type BlogPublishReadinessType = 'product' | 'info';

export interface BlogPublishReadinessInput {
  markdown: string;
  blogType: BlogPublishReadinessType;
  hasRuntimeInformationalCta?: boolean;
  slug: string;
  destination?: string | null;
  topic?: string | null;
  primaryKeyword?: string | null;
}

export interface BlogPublishReadinessRepairResult {
  markdown: string;
  changed: boolean;
  changes: string[];
}

function plainLength(markdown: string): number {
  return stripMarkup(markdown)
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function markdownLinkUrls(markdown: string): string[] {
  return [...markdown.matchAll(/(?<!!)\[[^\]]+]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1] || '')
    .filter(Boolean);
}

export function appendPublishReadinessSupport(input: BlogPublishReadinessInput): BlogPublishReadinessRepairResult {
  const trimmed = input.markdown.trimEnd();
  const minLength = input.blogType === 'info' ? 2550 : 1300;
  if (
    plainLength(trimmed) >= minLength
    || /##\s+(?:문의 전 최종 확인|출발 전 다시 확인할 기준)/.test(trimmed)
  ) {
    return { markdown: input.markdown, changed: false, changes: [] };
  }

  const destination = input.destination || input.primaryKeyword || input.topic || '여행';
  const topic = input.primaryKeyword || input.topic || destination;
  const support = input.blogType === 'product'
    ? [
        '## 문의 전 최종 확인',
        '',
        `${destination} 상품은 출발일, 인원, 항공 좌석, 객실 가능 여부에 따라 최종 금액과 포함 조건이 달라질 수 있습니다. 문의 전에는 희망 출발일과 인원, 원하는 객실 기준, 꼭 필요한 포함 항목을 함께 정리해 두면 상담 시간이 줄어듭니다.`,
        '',
        '| 확인 항목 | 왜 필요한가 |',
        '| --- | --- |',
        `| 출발일과 인원 | ${topic} 가능 좌석과 객실을 먼저 확인해야 합니다. |`,
        '| 포함/불포함 | 현지에서 추가 결제할 항목을 미리 분리해야 합니다. |',
        '| 변경 가능성 | 항공, 호텔, 현지 일정은 확정 전까지 조건이 달라질 수 있습니다. |',
      ].join('\n')
    : [
        '## 출발 전 다시 확인할 기준',
        '',
        `${destination} 일정은 계절, 항공 시간, 숙소 위치, 동행 구성에 따라 같은 키워드라도 실제 선택지가 달라집니다. 이 글의 기준으로 먼저 큰 방향을 정하고, 출발일과 인원, 예산 범위를 함께 적어 두면 불필요한 비교 시간을 줄일 수 있습니다.`,
        '',
        '| 확인 항목 | 체크 기준 |',
        '| --- | --- |',
        `| 일정 | ${topic}에서 가장 먼저 확정해야 할 날짜와 이동 동선입니다. |`,
        '| 예산 | 항공, 숙소, 현지 이동, 선택 투어를 나눠 봅니다. |',
        '| 리스크 | 날씨, 취소 규정, 현지 휴무처럼 바뀔 수 있는 정보를 다시 확인합니다. |',
      ].join('\n');

  return {
    markdown: `${trimmed}\n\n${support}`,
    changed: true,
    changes: ['appended_publish_readiness_support'],
  };
}

export function ensurePublisherInternalLinks(input: BlogPublishReadinessInput): BlogPublishReadinessRepairResult {
  if (input.blogType === 'info' && input.hasRuntimeInformationalCta) {
    return { markdown: input.markdown, changed: false, changes: [] };
  }
  const linkUrls = markdownLinkUrls(input.markdown);
  const internalCount = linkUrls.filter((href) => href.startsWith('/') || /yeosonam\.com/i.test(href)).length;
  if (internalCount >= 1) return { markdown: input.markdown, changed: false, changes: [] };

  const cta = buildStandardBlogCtaMarkdown({
    destination: input.destination,
    slug: input.slug,
    utmSource: 'naver_blog',
  });
  return {
    markdown: `${input.markdown.trimEnd()}\n\n---\n\n${cta}`,
    changed: true,
    changes: ['appended_standard_internal_cta'],
  };
}

export function repairPublishReadiness(input: BlogPublishReadinessInput): BlogPublishReadinessRepairResult {
  const changes: string[] = [];
  let markdown = input.markdown;

  const support = appendPublishReadinessSupport({ ...input, markdown });
  if (support.changed) {
    markdown = support.markdown;
    changes.push(...support.changes);
  }

  const internalLinks = ensurePublisherInternalLinks({ ...input, markdown });
  if (internalLinks.changed) {
    markdown = internalLinks.markdown;
    changes.push(...internalLinks.changes);
  }

  return {
    markdown,
    changed: markdown !== input.markdown,
    changes,
  };
}
