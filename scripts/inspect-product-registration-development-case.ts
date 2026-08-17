import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildCanonicalNormalization,
  diagnoseDocumentIrTableProductSplit,
} from '@/lib/product-registration-v4/canonical-worker';
import { extractSourceDocumentToIR } from '@/lib/product-registration-v4/extractions';
import { buildDocumentIrTableItineraries } from '@/lib/product-registration-v4/table-grid-itinerary';
import {
  buildDocumentIrTablePriceCalendarCandidates,
  buildDocumentIrTablePriceCalendars,
  parseDurationGradeRangePriceMatrix,
} from '@/lib/product-registration-v4/table-grid-price-calendar';
import { classifyProductSourceDocument } from '@/lib/product-registration-v6/document-classifier';
import {
  collectItineraryHeaderStarts,
  collectPkgBlockStarts,
  collectVariantCatalogBlockStarts,
  splitCatalogByItineraryHeaders,
} from '@/lib/parser/catalog-pre-split';

type Entry = {
  sourcePath: string;
  filename: string;
  sourceHash: string;
  lineageHash: string;
  split: 'development' | 'calibration' | 'frozen';
  duplicateOf: string | null;
  documentClass: string;
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('CORPUS_MANIFEST_REQUIRED'); })());
  const contains = arg('--contains');
  const sourceHash = arg('--source-hash');
  const requestedSplit = arg('--split');
  const operationalReferenceDate = arg('--operational-reference-date');
  if (!contains && !sourceHash) throw new Error('CASE_FILENAME_FRAGMENT_OR_SOURCE_HASH_REQUIRED');
  const outputPath = resolve(arg('--out', 'C:/Users/admin/Downloads/코덱스테스트/product-registration-development-case.json')!);
  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as { entries?: Entry[] };
  const matches = (manifest.entries ?? []).filter(entry => (
    !entry.duplicateOf
    && entry.split !== 'frozen'
    && (!requestedSplit || entry.split === requestedSplit)
    && (sourceHash
      ? entry.sourceHash === sourceHash
      : entry.filename.toLocaleLowerCase('ko-KR').includes(contains!.toLocaleLowerCase('ko-KR')))
  ));
  if (matches.length !== 1) {
    throw new Error(`CASE_MATCH_COUNT:${matches.length}:${matches.map(item => `${item.sourceHash}:${item.filename}`).join('|')}`);
  }
  const entry = matches[0]!;
  if (entry.split === 'frozen') throw new Error('FROZEN_CASE_INSPECTION_FORBIDDEN');
  if (entry.documentClass !== 'travel_product') throw new Error(`CASE_NOT_TRAVEL:${entry.documentClass}`);
  const buffer = await readFile(entry.sourcePath);
  const ir = await extractSourceDocumentToIR({ buffer, filename: entry.filename, sourceType: 'hwp' });
  const classification = classifyProductSourceDocument({ sourceType: 'hwp', documentIr: ir });
  const inspectionFallbackYear = Number(ir.text.match(/\b(20\d{2})\s*년/u)?.[1] ?? '')
    || Number(operationalReferenceDate?.slice(0, 4) ?? '')
    || null;
  const normalization = await buildCanonicalNormalization({
    documentIr: ir,
    sourceDocumentId: `development-inspection:${entry.sourceHash}`,
    extractionId: `development-inspection:${entry.sourceHash}`,
    departureDateReference: operationalReferenceDate ? {
      referenceDate: operationalReferenceDate,
      rollingInferenceEligible: true,
    } : null,
  });
  const tablePriceCalendars = buildDocumentIrTablePriceCalendars({
    documentIr: ir,
    sectionRawText: ir.text,
    fallbackYear: inspectionFallbackYear,
  });
  const tablePriceCalendarCandidates = ir.tables.flatMap(table => buildDocumentIrTablePriceCalendarCandidates({
    table,
    sectionRawText: ir.text,
    fallbackYear: inspectionFallbackYear,
  }));
  const durationGradeRangeMatrices = ir.tables.flatMap(table => parseDurationGradeRangePriceMatrix(
    table,
    inspectionFallbackYear,
  ));
  const tableItineraries = buildDocumentIrTableItineraries({
    documentIr: ir,
    sectionRawText: ir.text,
  });
  const catalogSplit = splitCatalogByItineraryHeaders(ir.text);
  const sectionTablePriceCalendars = normalization.sections.map(section => ({
    sectionIndex: section.index,
    titleHint: section.titleHint,
    calendars: buildDocumentIrTablePriceCalendars({
      documentIr: ir,
      sectionRawText: section.rawText,
      fallbackYear: inspectionFallbackYear,
    }),
  }));
  const artifact = {
    schemaVersion: 'product-registration-development-case-inspection-1',
    privateArtifact: true,
    frozenDataInspected: false,
    source: entry,
    classification,
    parser: ir.parser,
    pages: ir.pages,
    text: ir.text,
    tables: ir.tables.map(table => ({
      id: table.id,
      page: table.page,
      rows: table.rows,
      columns: table.columns,
      cells: table.cells.map(cell => ({
        row: cell.row,
        column: cell.column,
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
        text: cell.text,
      })),
    })),
    tablePriceCalendars,
    sectionTablePriceCalendars,
    tablePriceCalendarCandidates,
    durationGradeRangeMatrices,
    tableItineraries,
    catalogSegmentation: {
      itineraryStarts: collectItineraryHeaderStarts(ir.text),
      packageStarts: collectPkgBlockStarts(ir.text),
      variantStarts: collectVariantCatalogBlockStarts(ir.text),
      sharedPrefix: catalogSplit.sharedPrefix,
      sections: catalogSplit.sections,
    },
    tableProductSplitDiagnosis: diagnoseDocumentIrTableProductSplit(ir),
    normalization,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, filename: entry.filename, split: entry.split, sectionCount: normalization.sections.length }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
