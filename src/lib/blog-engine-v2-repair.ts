import type { BlogEngineEvaluation } from './blog-engine-v2';

type BlogEngineV2RepairInput = {
  markdown: string;
  topic?: string | null;
  primaryKeyword?: string | null;
  destination?: string | null;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
  evaluation?: BlogEngineEvaluation | null;
};

export type BlogEngineV2RepairResult = {
  markdown: string;
  generationMeta: Record<string, unknown>;
  changed: boolean;
  changes: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clean(value: unknown, fallback = ''): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function firstUsefulKeyword(input: BlogEngineV2RepairInput): string {
  return clean(input.primaryKeyword, clean(input.topic, '여행 준비'));
}

function answerFirstParagraph(input: BlogEngineV2RepairInput): string {
  const keyword = firstUsefulKeyword(input);
  const destination = clean(input.destination);
  const subject = destination && !keyword.includes(destination) ? `${destination} ${keyword}` : keyword;
  const intentText = `${keyword} ${input.topic ?? ''}`.toLowerCase();
  if (/weather|날씨|옷차림|우기|건기|기온|강수|태풍|준비물|체크리스트/.test(intentText)) {
    return `${subject}은 낮과 밤의 체감 차이, 비 가능성, 필요한 옷차림을 먼저 나눠 보면 됩니다. 출발 전 최신 예보와 현지 이동 조건을 확인하고, 표와 체크리스트를 기준으로 준비물을 조정하세요.`;
  }
  if (/cost|budget|price|비용|예산|경비|식비|환전|결제/.test(intentText)) {
    return `${subject}은 항공, 숙소, 이동, 식비를 따로 나눠 봐야 총액 판단이 쉽습니다. 출발일과 인원, 숙소 위치에 따라 실제 비용이 달라지므로 표와 체크리스트를 기준으로 비교하세요.`;
  }
  return `${subject}은 먼저 일정, 비용, 이동, 현지 변수 중 지금 결정해야 하는 항목을 나눠 보면 됩니다. 출발일과 인원, 숙소 위치에 따라 실제 준비 기준이 달라지므로 표와 체크리스트를 기준으로 확인하세요.`;
}

function replaceFirstBodyParagraph(markdown: string, paragraph: string): { markdown: string; changed: boolean } {
  const lines = markdown.split(/\r?\n/);
  const h1Index = lines.findIndex((line) => /^#\s+/.test(line.trim()));
  const start = h1Index >= 0 ? h1Index + 1 : 0;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (
      !trimmed
      || /^#{1,6}\s+/.test(trimmed)
      || /^\s*!\[[^\]]*]\([^)]+\)/.test(trimmed)
      || /^\s*\|.*\|\s*$/.test(trimmed)
      || /^\s*(?:[-*]|\d+\.)\s+/.test(trimmed)
    ) {
      continue;
    }

    if (trimmed === paragraph) return { markdown, changed: false };
    lines[index] = line.replace(trimmed, paragraph);
    return { markdown: lines.join('\n'), changed: true };
  }

  const insertAt = h1Index >= 0 ? h1Index + 1 : 0;
  lines.splice(insertAt, 0, '', paragraph);
  return { markdown: lines.join('\n').replace(/\n{4,}/g, '\n\n\n'), changed: true };
}

function fillArray(current: unknown, fallback: string[]): string[] {
  const existing = Array.isArray(current)
    ? current.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return existing.length > 0 ? existing : fallback;
}

function repairProductConsultBrief(input: BlogEngineV2RepairInput): Record<string, unknown> {
  const meta = { ...asRecord(input.generationMeta) };
  const brief = { ...asRecord(meta.product_consult_brief) };
  const destination = clean(input.destination, '여행지');

  brief.included = fillArray(brief.included, ['상품 상세 기준 포함 항목은 상담에서 최종 확인']);
  brief.excluded = fillArray(brief.excluded, ['개인경비와 선택관광은 상담에서 최종 확인']);
  brief.fit_for = fillArray(brief.fit_for, [`${destination} 상품을 가격, 일정, 포함사항 기준으로 먼저 비교하려는 고객`]);
  brief.not_fit_for = fillArray(brief.not_fit_for, ['호텔명, 항공 시간, 객실 조건이 확정된 뒤에만 결정하려는 고객']);
  brief.risk_notes = fillArray(brief.risk_notes, ['가격, 좌석, 객실 조건은 예약 시점에 따라 달라질 수 있음']);
  brief.consult_questions = fillArray(brief.consult_questions, [
    '출발 가능한 날짜와 인원은 어떻게 되나요?',
    '항공 시간과 호텔 등급은 확정 기준으로 볼 수 있나요?',
    '선택관광, 가이드/기사 경비, 추가 차지가 있나요?',
  ]);

  meta.product_consult_brief = brief;
  return meta;
}

function appendProductDecisionFallback(markdown: string, input: BlogEngineV2RepairInput): { markdown: string; changed: boolean } {
  if (/##\s*10초\s*판단/.test(markdown) && /##\s*문의\s*전\s*질문/.test(markdown)) {
    return { markdown, changed: false };
  }

  const destination = clean(input.destination, '여행지');
  const block = [
    '',
    '## 10초 판단',
    '',
    '| 확인 항목 | 현재 기준 | 문의 전 볼 점 |',
    '| --- | --- | --- |',
    '| 가격 | 출발일과 인원에 따라 변동 | 최종 가능 금액 확인 |',
    '| 기간 | 상품 일정 기준 | 이동 부담과 자유시간 확인 |',
    '| 포함 | 상품 상세 기준 | 불포함/추가비용 분리 확인 |',
    '',
    '## 이런 분께 맞습니다',
    '',
    `- ${destination} 상품을 가격, 일정, 포함사항 기준으로 먼저 비교하려는 고객`,
    '',
    '## 이런 분께는 맞지 않을 수 있습니다',
    '',
    '- 호텔명, 항공 시간, 객실 조건이 확정된 뒤에만 결정하려는 고객',
    '',
    '## 가격이 달라질 수 있는 조건',
    '',
    '- 출발일, 좌석 상황, 객실 타입, 환율, 선택관광, 인원 구성에 따라 달라질 수 있습니다.',
    '',
    '## 문의 전 질문',
    '',
    '- 출발 가능한 날짜와 인원은 어떻게 되나요?',
    '- 항공 시간과 호텔 등급은 확정 기준으로 볼 수 있나요?',
    '- 선택관광, 가이드/기사 경비, 추가 차지가 있나요?',
  ].join('\n');

  const next = `${markdown.trim()}\n\n${block}`.replace(/\n{4,}/g, '\n\n\n').trim();
  return { markdown: next, changed: next !== markdown };
}

function repairBrokenHtmlMutationArtifacts(markdown: string): { markdown: string; changed: boolean } {
  let changed = false;
  const lines = markdown.split(/\r?\n/);
  const repaired = lines.filter((line) => {
    const trimmed = line.trim();
    if (/^또한\s*>.*<\/figcaption>\s*$/i.test(trimmed)) {
      changed = true;
      return false;
    }
    if (/^또한\s+[^<\n]{0,80}<\/figcaption>\s*$/i.test(trimmed)) {
      changed = true;
      return false;
    }
    if (/^또한\s+s=["']blog-callout/i.test(trimmed)) {
      changed = true;
      return false;
    }
    if (/^또한\s+[^<\n]{0,40}<\/strong>\s*$/i.test(trimmed)) {
      changed = true;
      return false;
    }
    if (/^또한\s+.*<\/p>\s*$/i.test(trimmed)) {
      changed = true;
      return false;
    }
    return true;
  }).join('\n');

  return { markdown: repaired.replace(/\n{4,}/g, '\n\n\n'), changed: changed && repaired !== markdown };
}

function softenNaturalnessSurface(markdown: string): { markdown: string; changed: boolean } {
  let changed = false;
  let text = markdown
    .replace(/이게 말이 되나 싶으시죠[?.!]?/g, () => {
      changed = true;
      return '가격과 일정 조건을 먼저 확인해 보세요.';
    })
    .replace(/완벽\s*가이드|총정리/g, () => {
      changed = true;
      return '실전 체크';
    })
    .replace(/여소남\s*에디터가\s*추천|여소남\s*에디터/g, () => {
      changed = true;
      return '여소남';
    })
    .replace(/안녕하세요[^\n.!?。！？]{0,40}[.!?。！？]?/g, () => {
      changed = true;
      return '';
    })
    .replace(/오늘은\s*/g, () => {
      changed = true;
      return '';
    })
    .replace(/이번\s*글에서는\s*/g, () => {
      changed = true;
      return '';
    });

  const seen = new Set<string>();
  text = text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (
      !trimmed
      || /^#{1,6}\s+/.test(trimmed)
      || /^\s*(?:[-*]|\d+\.)\s+/.test(line)
      || /^\s*\|.*\|\s*$/.test(line)
      || /\[[^\]]+]\([^)]+\)/.test(line)
      || /<a\b[^>]*href=/i.test(line)
      || /^<\/?[a-z][^>]*>/i.test(trimmed)
      || /<\/?[a-z][^>]*>/i.test(line)
    ) {
      return line;
    }

    return line.replace(/([^.!?。！？]+[.!?。！？]?)(\s*)/g, (match, sentence: string, tail: string) => {
      const normalized = sentence.replace(/\s+/g, ' ').trim();
      const key = normalized.slice(0, 11);
      if (key.length < 8) return match;
      if (!seen.has(key)) {
        seen.add(key);
        return match;
      }
      const remainder = normalized.slice(key.length).replace(/^[은는이가을를도,\s]+/, '').trim();
      if (remainder.length < 8) return match;
      changed = true;
      const ending = /[.!?。！？]$/.test(sentence.trim()) ? sentence.trim().slice(-1) : '';
      return `또한 ${remainder}${ending}${tail}`;
    });
  }).join('\n');

  return { markdown: text, changed: changed && text !== markdown };
}

function softenCustomerLanguage(markdown: string): { markdown: string; changed: boolean } {
  let changed = false;
  const replacements: Array<[RegExp, string]> = [
    [/권해드립니다/g, '볼 수 있어요'],
    [/적합합니다/g, '맞습니다'],
    [/강력\s*추천(?:드립니다|합니다)?/g, '조건을 확인해 보세요'],
    [/추천(?:드립니다|합니다|해요)/g, '확인해 보세요'],
    [/가성비/g, '가격 조건'],
    [/합리적인\s*비용/g, '비용 기준'],
    [/실속\s*있는\s*구성/g, '포함 조건'],
    [/비용\s*부담\s*제로/g, '추가 비용 확인 필요'],
    [/고객\s*만족도/g, '이용 조건'],
    [/원활한\s*상담/g, '상담에서 확인'],
    [/현명합니다/g, '안전합니다'],
    [/특별한\s*(?:경험|추억)/g, '일정 경험'],
    [/인생\s*사진/g, '사진 포인트'],
    [/풍성한|알찬|알차게|제대로|만끽|짜릿한|신비로운/g, '확인할'],
    [/확인해\s*주시기\s*바랍니다/g, '확인해 주세요'],
    [/상세\s*일정을\s*체크해\s*드릴게요/g, '일정 흐름을 먼저 보겠습니다'],
  ];

  let text = markdown;
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, () => {
      changed = true;
      return replacement;
    });
  }

  return { markdown: text, changed: changed && text !== markdown };
}

function reduceTemplateRepetition(markdown: string, keyword: string): { markdown: string; changed: boolean } {
  let changed = false;
  const key = clean(keyword, '여행');
  const headingMap: Array<[RegExp, string]> = [
    [/^##\s*핵심\s*요약\s*$/gm, `## ${key} 먼저 볼 기준`],
    [/^##\s*상황별\s*선택\s*기준\s*$/gm, `## ${key} 상황별 확인 기준`],
    [/^##\s*읽는\s*순서\s*$/gm, '## 먼저 보면 좋은 순서'],
    [/^##\s*공식\s*확인\s*링크\s*$/gm, '## 출발 전 공식 확인'],
  ];

  let text = markdown;
  for (const [pattern, replacement] of headingMap) {
    text = text.replace(pattern, () => {
      changed = true;
      return replacement;
    });
  }

  const seenHeadings = new Map<string, number>();
  text = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^(##\s+)(.+)$/);
    if (!match) return line;
    const heading = match[2].trim();
    const count = seenHeadings.get(heading) ?? 0;
    seenHeadings.set(heading, count + 1);
    if (count === 0) return line;
    changed = true;
    if (/공식|확인/.test(heading)) return `${match[1]}출발 전 추가 확인`;
    if (/순서/.test(heading)) return `${match[1]}필요한 부분만 보는 순서`;
    if (/기준/.test(heading)) return `${match[1]}${key} 추가 판단 기준`;
    return `${match[1]}${key} 세부 확인 ${count + 1}`;
  }).join('\n');
  return { markdown: text, changed: changed && text !== markdown };
}

function diversifyRepeatedSentenceStarts(markdown: string): { markdown: string; changed: boolean } {
  const seen = new Map<string, number>();
  let changed = false;
  const text = markdown.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (
      !trimmed
      || /^#{1,6}\s+/.test(trimmed)
      || /^\s*(?:[-*]|\d+\.)\s+/.test(trimmed)
      || /^\s*\|.*\|\s*$/.test(trimmed)
      || /^\s*\[[^\]]+]\([^)]+\)\s*$/.test(trimmed)
      || /^\s*!\[[^\]]*]\([^)]+\)/.test(trimmed)
      || /^<\/?[a-z][^>]*>/i.test(trimmed)
      || /<\/?[a-z][^>]*>/i.test(line)
    ) {
      return line;
    }

    return line.replace(/([^.!?。！？\n]{12,}?)([.!?。！？])(\s*)/g, (match, sentence: string, ending: string, tail: string) => {
      const normalized = sentence.replace(/\s+/g, ' ').trim();
      const key = normalized.slice(0, 14);
      if (key.length < 10) return match;
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      if (count === 0) return match;
      const rest = normalized.slice(key.length).replace(/^[은는이가을를도,\s]+/, '').trim();
      if (rest.length < 8) return match;
      changed = true;
      const prefix = count % 2 === 0 ? '또한 ' : '이 경우 ';
      return `${prefix}${rest}${ending}${tail}`;
    });
  }).join('\n');
  return { markdown: text, changed: changed && text !== markdown };
}

function softenRepeatedKeywordStarts(markdown: string, keyword: string): { markdown: string; changed: boolean } {
  const key = clean(keyword);
  if (key.length < 3) return { markdown, changed: false };
  let seen = 0;
  let changed = false;
  const pattern = new RegExp(`(^|[.!?。！？]\\s+)(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(은|는|이|가)?\\s+`, 'g');
  const text = markdown.replace(pattern, (match, prefix: string, _matched: string, particle: string | undefined) => {
    seen += 1;
    if (seen <= 1) return match;
    changed = true;
    const replacement = seen % 2 === 0 ? '이 일정은 ' : '이 조건은 ';
    return `${prefix}${replacement}${particle && /[이가]/.test(particle) ? '' : ''}`;
  });
  return { markdown: text, changed: changed && text !== markdown };
}

export function repairBlogEngineV2Readiness(input: BlogEngineV2RepairInput): BlogEngineV2RepairResult {
  const evaluation = input.evaluation;
  const writer = evaluation?.brief.writer_type ?? (input.productId ? 'product_consultant_writer' : 'info_writer');
  let markdown = input.markdown;
  let generationMeta = { ...asRecord(input.generationMeta) };
  const changes: string[] = [];

  const brokenHtmlRepair = repairBrokenHtmlMutationArtifacts(markdown);
  if (brokenHtmlRepair.changed) {
    markdown = brokenHtmlRepair.markdown;
    changes.push('engine_v2_broken_html_artifacts');
  }

  if (writer === 'info_writer' && (evaluation?.metrics.task_completion ?? 100) < 95) {
    const repaired = replaceFirstBodyParagraph(markdown, answerFirstParagraph(input));
    if (repaired.changed) {
      markdown = repaired.markdown;
      changes.push('engine_v2_answer_first_intro');
      generationMeta.info_guide_brief = {
        ...asRecord(generationMeta.info_guide_brief),
        answer_first: answerFirstParagraph(input),
      };
    }
  }

  if ((evaluation?.metrics.naturalness ?? 100) < 95) {
    const naturalnessRepair = softenNaturalnessSurface(markdown);
    if (naturalnessRepair.changed) {
      markdown = naturalnessRepair.markdown;
      changes.push('engine_v2_naturalness_surface');
    }
    const keywordRepair = softenRepeatedKeywordStarts(markdown, firstUsefulKeyword(input));
    if (keywordRepair.changed) {
      markdown = keywordRepair.markdown;
      changes.push('engine_v2_repeated_keyword_starts');
    }
    const repeatedStartRepair = diversifyRepeatedSentenceStarts(markdown);
    if (repeatedStartRepair.changed) {
      markdown = repeatedStartRepair.markdown;
      changes.push('engine_v2_repeated_sentence_starts');
    }
  }

  if ((evaluation?.metrics.customer_language ?? 100) < 95) {
    const languageRepair = softenCustomerLanguage(markdown);
    if (languageRepair.changed) {
      markdown = languageRepair.markdown;
      changes.push('engine_v2_customer_language');
    }
  }

  if ((evaluation?.metrics.template_repetition ?? 100) < 95) {
    const repetitionRepair = reduceTemplateRepetition(markdown, firstUsefulKeyword(input));
    if (repetitionRepair.changed) {
      markdown = repetitionRepair.markdown;
      changes.push('engine_v2_template_repetition');
    }
    const repeatedStartRepair = diversifyRepeatedSentenceStarts(markdown);
    if (repeatedStartRepair.changed) {
      markdown = repeatedStartRepair.markdown;
      changes.push('engine_v2_template_sentence_starts');
    }
  }

  if (
    writer === 'product_consultant_writer'
    && (
      (evaluation?.metrics.product_decision_helpfulness ?? 100) < 95
      || (evaluation?.metrics.decision_clarity ?? 100) < 95
      || (evaluation?.metrics.risk_disclosure ?? 100) < 95
    )
  ) {
    const nextMeta = repairProductConsultBrief({ ...input, generationMeta });
    if (JSON.stringify(nextMeta) !== JSON.stringify(generationMeta)) {
      generationMeta = nextMeta;
      changes.push('engine_v2_product_consult_brief');
    }
    const repaired = appendProductDecisionFallback(markdown, input);
    if (repaired.changed) {
      markdown = repaired.markdown;
      changes.push('engine_v2_product_decision_blocks');
    }
  }

  return {
    markdown,
    generationMeta,
    changed: markdown !== input.markdown || JSON.stringify(generationMeta) !== JSON.stringify(asRecord(input.generationMeta)),
    changes,
  };
}
