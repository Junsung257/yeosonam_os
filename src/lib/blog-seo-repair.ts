export interface BlogSeoMetadataRepairInput {
  seoTitle?: string | null;
  seoDescription?: string | null;
  topic?: string | null;
  primaryKeyword?: string | null;
  destination?: string | null;
  category?: string | null;
}

export interface BlogSeoMetadataRepairResult {
  seoTitle: string;
  seoDescription: string;
  changed: boolean;
  changes: string[];
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function pickKeyword(input: BlogSeoMetadataRepairInput): string {
  return compact(input.primaryKeyword || input.destination || input.topic || '여행 준비');
}

function pickIntentTerm(input: BlogSeoMetadataRepairInput): string {
  const source = `${input.category || ''} ${input.topic || ''} ${input.seoTitle || ''}`.toLowerCase();
  if (/weather|날씨|태풍|우기|비|기온/.test(source)) return '날씨·준비물';
  if (/cost|price|budget|비용|예산|항공권|요금|가격/.test(source)) return '비용·예약';
  if (/itinerary|course|일정|코스/.test(source)) return '일정·코스';
  if (/visa|passport|document|비자|여권|서류/.test(source)) return '서류·주의사항';
  if (/preparation|checklist|준비|체크/.test(source)) return '준비물·체크리스트';
  return '비용·일정 체크리스트';
}

function buildTitle(input: BlogSeoMetadataRepairInput): string {
  const keyword = pickKeyword(input);
  const intent = pickIntentTerm(input);
  const candidates = [
    `${keyword} 2026 ${intent}`,
    `${keyword} ${intent}, 2026 기준`,
    `${keyword} 체크리스트 | 비용·일정·주의사항`,
  ].map(compact);

  return candidates.find(title => title.length >= 25 && title.length <= 60)
    || compact(`${keyword} ${intent}`).slice(0, 60);
}

function buildDescription(input: BlogSeoMetadataRepairInput, title: string): string {
  const keyword = pickKeyword(input);
  const intent = pickIntentTerm(input).replace(/·/g, ', ');
  const base = `${keyword} ${intent} 기준을 2026년 최신 정보로 정리했습니다. 비용, 일정, 준비물, 주의사항을 3분 안에 확인하고 출발 전 체크리스트로 바로 점검하세요.`;
  const desc = compact(base);
  if (desc.length >= 70 && desc.length <= 160) return desc;
  const fallback = `${title} 기준으로 비용, 일정, 준비물, 주의사항을 한 번에 확인할 수 있게 정리했습니다.`;
  return compact(fallback).slice(0, 160);
}

export function repairBlogSeoMetadata(input: BlogSeoMetadataRepairInput): BlogSeoMetadataRepairResult {
  const changes: string[] = [];
  const currentTitle = compact(input.seoTitle || '');
  const currentDescription = compact(input.seoDescription || '');
  const keyword = pickKeyword(input);
  const titleNeedsRepair =
    currentTitle.length < 25 ||
    currentTitle.length > 60 ||
    !currentTitle.includes(keyword) ||
    !/(20\d{2}|최신|월별|비용|일정|준비물|가격|코스|날씨|체크리스트)/.test(currentTitle) ||
    /(완벽|끝판왕|무조건|충격|대박|실화)/.test(currentTitle);
  const seoTitle = titleNeedsRepair ? buildTitle(input) : currentTitle;
  if (seoTitle !== currentTitle) changes.push('seo_title');

  const descriptionNeedsRepair =
    currentDescription.length < 70 ||
    currentDescription.length > 160 ||
    !currentDescription.includes(keyword) ||
    !/\d|비용|일정|준비|예약|포함|날씨|월별|체크/.test(currentDescription) ||
    currentDescription === seoTitle;
  const seoDescription = descriptionNeedsRepair
    ? buildDescription(input, seoTitle)
    : currentDescription;
  if (seoDescription !== currentDescription) changes.push('seo_description');

  return {
    seoTitle,
    seoDescription,
    changed: changes.length > 0,
    changes,
  };
}
