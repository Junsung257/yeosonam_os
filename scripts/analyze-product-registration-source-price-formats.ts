import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { extractSourceDocumentToIR } from '@/lib/product-registration-v4/extractions';

type Split = 'development' | 'calibration' | 'frozen';

type CorpusEntry = {
  sourcePath: string;
  filename: string;
  sourceHash: string | null;
  split: Split;
  duplicateOf: string | null;
  documentClass: string;
  prelabel?: {
    blockers?: string[];
    sectionBlockers?: string[][];
    sourceSalePriceDispositions?: string[];
    departureDatePolicy?: { sectionDispositions?: string[] };
  };
};

type Finding = {
  code: string;
  label: string;
  recommendedFormat: string;
  filename: string;
  sourceHash: string;
  split: Exclude<Split, 'frozen'>;
  priceBlocked: boolean;
  excerpt: string;
  location: string;
};

type PatternDefinition = {
  code: string;
  label: string;
  recommendedFormat: string;
  matches: (line: string) => boolean;
};

const definitions: PatternDefinition[] = [
  {
    code: 'TRAILING_COMMA_THOUSAND',
    label: '천원 단위 숫자 뒤 쉼표만 표기',
    recommendedFormat: '`성인 판매가 799,000원`처럼 전체 금액과 원 단위를 적습니다.',
    matches: line => /^\s*\d{2,4},\s*$/u.test(line),
  },
  {
    code: 'DASH_PADDED_THOUSAND',
    label: '천원 단위 숫자 뒤 하이픈 채움',
    recommendedFormat: '`성인 판매가 699,000원`으로 바꾸고 `699,---` 표기는 사용하지 않습니다.',
    matches: line => /(?:^|[^\d])\d{2,4}\s*,?\s*-{2,}(?:\s|원|$)/u.test(line),
  },
  {
    code: 'COMMA_DASH_PRICE',
    label: '쉼표-하이픈 가격 표기',
    recommendedFormat: '`1,159,000원`으로 바꾸고 `1,159,-` 표기는 사용하지 않습니다.',
    matches: line => /(?:^|[^\d])\d{1,3}(?:,\d{3})*,\s*-+(?:\s*원|\s|$)/u.test(line),
  },
  {
    code: 'BARE_SPECIAL_THOUSAND',
    label: '특가·판매가에 천원 단위 숫자만 표기',
    recommendedFormat: '`특가 799,000원`처럼 전체 금액을 적습니다.',
    matches: line => (
      /(?:^|[^\d])\d{2,4}\s*(?:특가|상품가|판매가)(?:[^\p{L}\d]|$)/iu.test(line)
      || /(?:특가|상품가|판매가)\s*[:：]?\s*\d{2,4}(?![\d,.])/iu.test(line)
    ),
  },
  {
    code: 'DOT_THOUSANDS',
    label: '마침표 천단위 구분',
    recommendedFormat: '`399,000원`처럼 천단위는 쉼표로 통일합니다.',
    matches: line => /^\s*\d{1,3}(?:\.\d{3})+(?:\s*원)?\s*$/u.test(line),
  },
  {
    code: 'MAN_WON_WITHOUT_WON',
    label: '만원 숫자만 표기',
    recommendedFormat: '`성인 판매가 790,000원`처럼 원 단위 전체 금액을 적습니다.',
    matches: line => (
      !/(?:컴|커미션)\s*\d{1,4}(?:\.\d+)?\s*만/iu.test(line)
      && /(?:판매가|상품가|성인\s*(?:기준\s*)?요금|특가).{0,24}\d{1,4}(?:\.\d+)?\s*만(?!\s*원)/iu.test(line)
    ),
  },
  {
    code: 'PRICE_RANGE_OR_SLASH',
    label: '여러 가격을 슬래시·물결·화살표로 한 칸에 표기',
    recommendedFormat: '출발일별 판매가를 행으로 분리하고, 인하가는 `기존가`와 `최종 판매가` 열로 구분합니다.',
    matches: line => (
      /(?:판매가|상품가|성인\s*(?:기준\s*)?요금|특가).{0,40}\d{3,4}(?:,\d{3})?\s*(?:\/|~|→|->|⇒)\s*\d{3,4}(?:,\d{3})?/iu.test(line)
      || /^\s*\d{3}\s*(?:\/|~|→|->|⇒)\s*\d{3}\s*$/u.test(line)
      || /\d{1,3},\d{3}\s*(?:→|->|⇒)\s*\d{1,3},\d{3}/u.test(line)
    ),
  },
  {
    code: 'SALE_AND_NET_MIXED_LINE',
    label: '판매가·NET·커미션을 같은 줄에 혼합',
    recommendedFormat: '`성인 판매가`, `랜드사 NET`, `커미션`을 서로 다른 열로 분리합니다.',
    matches: line => /(?:판매가|상품가).{0,40}(?:\bnet\b|원가|커미션)|(?:\bnet\b|원가|커미션).{0,40}(?:판매가|상품가)/iu.test(line),
  },
  {
    code: 'PRICE_WITHOUT_CURRENCY',
    label: '전체 금액이지만 통화·원 단위 부재',
    recommendedFormat: '`성인 판매가 799,000원(KRW)`처럼 금액 단위를 적습니다.',
    matches: line => /(?:판매가|상품가|여행경비|성인\s*요금)\s*[:：]?\s*\d{1,3}(?:,\d{3})+(?!\s*(?:원|KRW))/iu.test(line),
  },
];

const structuralDefinitions: Array<PatternDefinition & { risk: 'critical' | 'high' }> = [
  {
    code: 'STRUCTURE_PRICE_DATE_SCOPE',
    label: '출발일과 판매가 적용 관계 불명확',
    recommendedFormat: '한 행을 `출발일(YYYY-MM-DD) | 성인 판매가(KRW)`로 만들고, 기간가는 시작일·종료일을 각각 적습니다.',
    risk: 'critical',
    matches: blocker => /(?:판매가.*출발일|출발일.*판매가|PRICE_SCOPE|적용 관계)/iu.test(blocker),
  },
  {
    code: 'STRUCTURE_PRICE_EVIDENCE',
    label: '가격 숫자와 원문 근거 셀 연결 실패',
    recommendedFormat: '가격 제목과 숫자를 같은 표의 같은 행에 두고, 병합 셀·떠 있는 텍스트 상자를 피합니다.',
    risk: 'critical',
    matches: blocker => /(?:판매가 금액.*evidence|원문 evidence|금액.*재확인)/iu.test(blocker),
  },
  {
    code: 'STRUCTURE_INCLUSIONS_EXCLUSIONS',
    label: '포함·불포함 범위 불명확',
    recommendedFormat: '상품마다 `포함사항`과 `불포함사항`을 각각 두고, 여러 상품의 공통 문구라면 `전 상품 공통`이라고 명시합니다.',
    risk: 'critical',
    matches: blocker => /(?:포함사항|불포함사항)/u.test(blocker),
  },
  {
    code: 'STRUCTURE_ITINERARY_DAY',
    label: '고객용 DAY 일정 구조 부재',
    recommendedFormat: '`DAY 1`, `DAY 2`처럼 일자를 명시하고 각 DAY 안에 이동·관광·식사·호텔을 순서대로 적습니다.',
    risk: 'high',
    matches: blocker => /(?:DAY 일정|일정 구조)/iu.test(blocker),
  },
  {
    code: 'STRUCTURE_LODGING',
    label: '호텔명 또는 미정·동급 상태 불명확',
    recommendedFormat: '호텔을 확정할 수 없으면 `호텔 미정(출발 전 확정)` 또는 `OO호텔 또는 동급`이라고 적습니다.',
    risk: 'high',
    matches: blocker => /(?:숙박명|숙박 확정|호텔.*근거)/u.test(blocker),
  },
  {
    code: 'STRUCTURE_FLIGHT',
    label: '항공편·노선·시간 구조 불명확',
    recommendedFormat: '`편명 | 출발공항 | 도착공항 | 출발시각 | 도착시각 | 도착일+1 여부` 열로 분리합니다.',
    risk: 'high',
    matches: blocker => /(?:항공|편명|출도착|FLIGHT)/iu.test(blocker),
  },
  {
    code: 'STRUCTURE_DEPARTURE_YEAR',
    label: '출발연도 또는 날짜 문맥 충돌',
    recommendedFormat: '가능하면 출발일을 `YYYY-MM-DD`로 적고, 문서 머리말의 판매기간 연도와 법규·공지 연도를 분리합니다.',
    risk: 'critical',
    matches: blocker => /(?:PRICE_DATE_YEAR|출발.*연도|연도.*충돌)/iu.test(blocker),
  },
  {
    code: 'STRUCTURE_CANCELLATION',
    label: '취소·환불 조건 적용 범위 부재',
    recommendedFormat: '상품 또는 문서 전체에 적용되는 `취소·환불 특별약관`을 명시하고 적용 상품 범위를 적습니다.',
    risk: 'critical',
    matches: blocker => /(?:CANCELLATION_POLICY|취소.*조건|환불.*조건)/iu.test(blocker),
  },
];

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalizedExcerpt(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, 240);
}

function isPriceBlocked(entry: CorpusEntry): boolean {
  const blockers = [
    ...(entry.prelabel?.blockers ?? []),
    ...(entry.prelabel?.sectionBlockers ?? []).flat(),
  ].join('\n');
  return /(?:판매가|금액|가격|price|통화|SOURCE_SALE_PRICE)/iu.test(blockers);
}

function activeSectionBlockers(entry: CorpusEntry): string[] {
  if (!entry.prelabel?.sectionBlockers) return entry.prelabel?.blockers ?? [];
  return entry.prelabel.sectionBlockers.flatMap((blockers, sectionIndex) => (
    entry.prelabel?.departureDatePolicy?.sectionDispositions?.[sectionIndex] === 'past_only_excluded'
      ? []
      : blockers
  ));
}

function addFinding(findings: Finding[], seen: Set<string>, finding: Finding): void {
  const key = `${finding.sourceHash}:${finding.code}:${finding.location}:${finding.excerpt}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('PRICE_FORMAT_MANIFEST_REQUIRED'); })());
  const outputPath = resolve(arg(
    '--out',
    'C:/Users/admin/Downloads/코덱스테스트/product-registration-source-price-format-audit.json',
  )!);
  const markdownOutputPath = arg('--markdown-out');
  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as {
    schemaVersion?: string;
    entries?: CorpusEntry[];
  };
  if (manifest.schemaVersion !== 'product-registration-private-corpus-1') {
    throw new Error('PRICE_FORMAT_MANIFEST_SCHEMA_INVALID');
  }
  const entries = (manifest.entries ?? []).filter((entry): entry is CorpusEntry & {
    sourceHash: string;
    split: Exclude<Split, 'frozen'>;
  } => (
    !entry.duplicateOf
    && entry.documentClass === 'travel_product'
    && entry.split !== 'frozen'
    && Boolean(entry.sourceHash)
  ));
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let extractionFailures = 0;

  for (const entry of entries) {
    try {
      const buffer = await readFile(entry.sourcePath);
      const ir = await extractSourceDocumentToIR({ buffer, filename: entry.filename, sourceType: 'hwp' });
      const priceBlocked = isPriceBlocked(entry);
      const activeBlockers = activeSectionBlockers(entry);
      for (const definition of structuralDefinitions) {
        const blocker = activeBlockers.find(value => definition.matches(value));
        if (!blocker) continue;
        addFinding(findings, seen, {
          code: definition.code,
          label: definition.label,
          recommendedFormat: definition.recommendedFormat,
          filename: entry.filename,
          sourceHash: entry.sourceHash,
          split: entry.split,
          priceBlocked: true,
          excerpt: normalizedExcerpt(blocker),
          location: 'validation',
        });
      }
      if (/[ㄱ-ㆎ]/u.test(entry.filename)) {
        addFinding(findings, seen, {
          code: 'FILENAME_DECOMPOSED_HANGUL',
          label: '파일명이 자모 단위로 분해됨',
          recommendedFormat: '파일명을 정상 완성형 한글로 다시 입력합니다. 예: `요금표_푸꾸옥_부산출발...hwp`.',
          filename: entry.filename,
          sourceHash: entry.sourceHash,
          split: entry.split,
          priceBlocked,
          excerpt: entry.filename,
          location: 'filename',
        });
      }
      if (/�||[\x00-\x08\x0B\x0C\x0E-\x1F]/u.test(entry.filename)) {
        addFinding(findings, seen, {
          code: 'FILENAME_ENCODING_CORRUPTION',
          label: '파일명 문자 인코딩 손상',
          recommendedFormat: '깨진 문자를 삭제하지 말고 원래 의미(커미션·발권일 등)를 확인해 정상 한글/숫자로 다시 입력합니다.',
          filename: entry.filename,
          sourceHash: entry.sourceHash,
          split: entry.split,
          priceBlocked,
          excerpt: entry.filename,
          location: 'filename',
        });
      }
      const lines = [entry.filename, ...ir.text.split(/\r?\n/gu)]
        .map(normalizedExcerpt)
        .filter(Boolean);
      for (const [lineIndex, line] of lines.entries()) {
        for (const definition of definitions) {
          if (!definition.matches(line)) continue;
          addFinding(findings, seen, {
            code: definition.code,
            label: definition.label,
            recommendedFormat: definition.recommendedFormat,
            filename: entry.filename,
            sourceHash: entry.sourceHash,
            split: entry.split,
            priceBlocked,
            excerpt: line,
            location: lineIndex === 0 ? 'filename' : `text:${lineIndex}`,
          });
        }
      }

      for (const table of ir.tables) {
        const cells = table.cells.map(cell => normalizedExcerpt(cell.text));
        const hasPriceLabelCell = cells.some(cell => /^(?:성인|대인|상품가|판매가|여행경비|여행요금|특가)$/iu.test(cell));
        const amountOnlyCells = table.cells.filter(cell => (
          /^(?:₩\s*)?\d{2,4}(?:[,.]\d{3})*(?:\s*,-|\s*,|\s*-{2,}|\s*원)?$/u.test(normalizedExcerpt(cell.text))
        ));
        if (hasPriceLabelCell && amountOnlyCells.length > 0) {
          for (const cell of amountOnlyCells.slice(0, 6)) {
            addFinding(findings, seen, {
              code: 'SPLIT_LABEL_AMOUNT_CELLS',
              label: '가격 제목과 금액이 서로 다른 표 셀에 분리',
              recommendedFormat: '`출발일 | 성인 판매가(KRW)` 열을 만들고 같은 행에 날짜와 금액을 둡니다.',
              filename: entry.filename,
              sourceHash: entry.sourceHash,
              split: entry.split,
              priceBlocked,
              excerpt: normalizedExcerpt(cell.text),
              location: `table:${table.id}:r${cell.row}:c${cell.column}`,
            });
          }
        }
      }

      const fullText = normalizedExcerpt(ir.text.slice(0, 20_000));
      const dispositions = entry.prelabel?.sourceSalePriceDispositions ?? [];
      if (
        dispositions.some(value => value === 'source_price_requires_resolution')
        && /(?:요금\s*표|가격\s*표)/iu.test(`${entry.filename}\n${fullText}`)
      ) {
        addFinding(findings, seen, {
          code: 'PRICE_TABLE_UNRESOLVED',
          label: '요금표라고 명시됐지만 판매가 연결 실패',
          recommendedFormat: '표 머리글을 `출발일 | 성인 판매가(KRW) | 아동가 | 싱글차지`로 고정하고 병합 셀을 줄입니다.',
          filename: entry.filename,
          sourceHash: entry.sourceHash,
          split: entry.split,
          priceBlocked,
          excerpt: entry.filename,
          location: 'document',
        });
      }
    } catch {
      extractionFailures += 1;
    }
  }

  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const values = grouped.get(finding.code) ?? [];
    values.push(finding);
    grouped.set(finding.code, values);
  }
  const categories = [...grouped.entries()].map(([code, values]) => ({
    code,
    label: values[0]!.label,
    recommendedFormat: values[0]!.recommendedFormat,
    sourceCount: new Set(values.map(value => value.sourceHash)).size,
    blockedSourceCount: new Set(values.filter(value => value.priceBlocked).map(value => value.sourceHash)).size,
    occurrenceCount: values.length,
    files: [...new Set(values.map(value => value.filename))].sort((left, right) => left.localeCompare(right, 'ko')),
    blockedFiles: [...new Set(values.filter(value => value.priceBlocked).map(value => value.filename))]
      .sort((left, right) => left.localeCompare(right, 'ko')),
    blockedFileExamples: [...new Set(values.filter(value => value.priceBlocked).map(value => value.filename))]
      .sort((left, right) => left.localeCompare(right, 'ko'))
      .map(filename => ({
        filename,
        examples: [...new Set(values
          .filter(value => value.priceBlocked && value.filename === filename)
          .map(value => value.excerpt))].slice(0, 20),
      })),
    samples: values.slice(0, 12).map(value => ({
      filename: value.filename,
      excerpt: value.excerpt,
      location: value.location,
      priceBlocked: value.priceBlocked,
    })),
  })).sort((left, right) => (
    right.blockedSourceCount - left.blockedSourceCount
    || right.sourceCount - left.sourceCount
    || left.code.localeCompare(right.code)
  ));

  const artifact = {
    schemaVersion: 'product-registration-source-price-format-audit-1',
    privateArtifact: true,
    sourceManifest: manifestPath,
    frozenDataInspected: false,
    scannedSourceCount: entries.length,
    extractionFailures,
    categoryCount: categories.length,
    categories,
  };
  const markdown = [
    '# 상품 원문 가격·구조 정렬 체크리스트',
    '',
    `- 검사 원문: ${entries.length}개 (development/calibration 전용)`,
    `- 추출 실패: ${extractionFailures}개`,
    '- frozen 정답군 개별 원문: 열람하지 않음',
    '- `[차단 연결]`은 현재 가격 또는 상품 구조 차단과 연결된 파일입니다.',
    '',
    ...categories.flatMap(category => {
      const blocked = new Set(category.blockedFiles);
      return [
        `## ${category.label}`,
        '',
        `- 코드: \`${category.code}\``,
        `- 전체 ${category.sourceCount}개 / 현재 차단 연결 ${category.blockedSourceCount}개`,
        `- 권장 정렬: ${category.recommendedFormat}`,
        '',
        ...category.files.map(filename => `- [ ] ${blocked.has(filename) ? '[차단 연결]' : '[형식 통일 권장]'} ${filename}`),
        '',
      ];
    }),
  ].join('\n');
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8'),
    ...(markdownOutputPath ? [writeFile(resolve(markdownOutputPath), `${markdown}\n`, 'utf8')] : []),
  ]);
  console.log(JSON.stringify({
    outputPath,
    scannedSourceCount: entries.length,
    extractionFailures,
    categories: categories.map(category => ({
      code: category.code,
      sourceCount: category.sourceCount,
      blockedSourceCount: category.blockedSourceCount,
      occurrenceCount: category.occurrenceCount,
      samples: category.samples.slice(0, 4),
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
