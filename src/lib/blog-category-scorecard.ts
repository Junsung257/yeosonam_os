export type BlogCategoryScorecardInput = {
  category: string;
  publishReady: boolean;
  researchRequired: boolean;
  researchVerified: boolean;
  seoScore: number | null;
  readabilityScore: number | null;
  engineScore: number | null;
  componentFloor: number | null;
  imageCount: number;
};

export type BlogCategoryScorecardRow = {
  category: string;
  total: number;
  publishReadyCount: number;
  publishReadyRate: number;
  researchRequiredCount: number;
  researchVerifiedCount: number;
  researchCoverage: number;
  imageReadyCount: number;
  imageCoverage: number;
  minimumSeoScore: number;
  minimumReadabilityScore: number;
  minimumEngineScore: number;
  minimumComponentScore: number;
  score: number;
  passed95: boolean;
};

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Math.round((numerator / denominator) * 100);
}

function minimum(values: Array<number | null>): number {
  if (values.length === 0 || values.some((value) => typeof value !== 'number')) return 0;
  return Math.min(...values as number[]);
}

export function buildBlogCategoryScorecard(
  rows: BlogCategoryScorecardInput[],
): BlogCategoryScorecardRow[] {
  const grouped = new Map<string, BlogCategoryScorecardInput[]>();
  for (const row of rows) {
    const category = row.category.trim() || 'unclassified';
    grouped.set(category, [...(grouped.get(category) ?? []), row]);
  }

  return [...grouped.entries()]
    .map(([category, categoryRows]) => {
      const publishReadyCount = categoryRows.filter((row) => row.publishReady).length;
      const researchRows = categoryRows.filter((row) => row.researchRequired);
      const researchVerifiedCount = researchRows.filter((row) => row.researchVerified).length;
      const imageReadyCount = categoryRows.filter((row) => row.imageCount >= 3).length;
      const publishReadyRate = percentage(publishReadyCount, categoryRows.length);
      const researchCoverage = percentage(researchVerifiedCount, researchRows.length);
      const imageCoverage = percentage(imageReadyCount, categoryRows.length);
      const minimumSeoScore = minimum(categoryRows.map((row) => row.seoScore));
      const minimumReadabilityScore = minimum(categoryRows.map((row) => row.readabilityScore));
      const minimumEngineScore = minimum(categoryRows.map((row) => row.engineScore));
      const minimumComponentScore = minimum(categoryRows.map((row) => row.componentFloor));
      const score = Math.min(
        publishReadyRate,
        researchCoverage,
        imageCoverage,
        minimumSeoScore,
        minimumReadabilityScore,
        minimumEngineScore,
        minimumComponentScore,
      );

      return {
        category,
        total: categoryRows.length,
        publishReadyCount,
        publishReadyRate,
        researchRequiredCount: researchRows.length,
        researchVerifiedCount,
        researchCoverage,
        imageReadyCount,
        imageCoverage,
        minimumSeoScore,
        minimumReadabilityScore,
        minimumEngineScore,
        minimumComponentScore,
        score,
        passed95: score >= 95,
      };
    })
    .sort((left, right) => left.score - right.score || left.category.localeCompare(right.category));
}
