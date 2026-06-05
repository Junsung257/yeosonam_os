import type { ExtractedData } from '@/lib/parser';
import { recordSignal, lookupSignal } from '@/lib/parser/classification-signals';
import { parseSections, classifyItem as classifyByContext } from '@/lib/parser/section-aware-parser';

export async function recordUploadSectionSignals(input: {
  rawText: string;
  extractedData: ExtractedData;
}): Promise<void> {
  const rawText = input.rawText;
  const ed = input.extractedData;
  if (!rawText.trim()) return;

  const sectionResult = parseSections(rawText);
  const recordOne = async (text: string, defaultCategory: 'inclusion' | 'optional' | 'exclude' | 'perk') => {
    if (!text || text.length < 2 || text.length > 200) return;
    const prior = await lookupSignal(text, ed.destination ?? null).catch(() => null);
    const offset = rawText.indexOf(text);
    const ctx = offset >= 0 ? sectionResult.classifyOffset(offset) : 'unknown';
    const final = classifyByContext(text, ctx);
    const chosen = prior?.category ?? (final.category === 'unknown' ? defaultCategory : final.category);
    void recordSignal({
      keyword: text,
      category: chosen,
      destination: ed.destination ?? null,
      product_type: ed.product_type ?? null,
      source: prior ? prior.source : 'local',
      confidence: prior ? (prior.confidence + final.confidence) / 2 : final.confidence,
    });
  };

  for (const inc of ed.inclusions ?? []) void recordOne(inc, 'inclusion');
  for (const exc of ed.excludes ?? []) void recordOne(exc, 'exclude');
  for (const opt of ed.optional_tours ?? []) {
    const name = (opt as { name?: string })?.name;
    if (name) void recordOne(name, 'optional');
  }
}
