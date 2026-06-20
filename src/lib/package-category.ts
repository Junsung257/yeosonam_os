export const PACKAGE_CATEGORY_MATCH_ALIASES: Record<string, string[]> = {
  honeymoon: ['honeymoon', '허니문', '신혼', '신혼여행'],
  golf: ['golf', '골프', '해외골프', '골프여행'],
  cruise: ['cruise', '크루즈'],
  theme: ['theme', '테마', '테마여행', '기획전'],
};

export type PackageCategoryMatchInput = {
  title?: string | null;
  display_title?: string | null;
  hero_tagline?: string | null;
  destination?: string | null;
  country?: string | null;
  category?: string | null;
  product_type?: string | null;
  trip_style?: string | null;
  product_tags?: Array<string | null> | null;
  product_highlights?: Array<string | null> | null;
};

function normalizeCategoryText(value: string): string {
  return value.toLocaleLowerCase('ko-KR').replace(/[\s_-]+/g, '');
}

function toTextArray(values: Array<string | null> | null | undefined): string[] {
  return values?.filter((value): value is string => Boolean(value)) ?? [];
}

export function packageMatchesCategory(pkg: PackageCategoryMatchInput, category: string): boolean {
  if (!category) return true;
  const aliases = PACKAGE_CATEGORY_MATCH_ALIASES[category] ?? [category];
  const normalizedAliases = aliases.map(normalizeCategoryText);
  const packageText = [
    pkg.title,
    pkg.display_title,
    pkg.hero_tagline,
    pkg.destination,
    pkg.country,
    pkg.category,
    pkg.product_type,
    pkg.trip_style,
    ...toTextArray(pkg.product_tags),
    ...toTextArray(pkg.product_highlights),
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeCategoryText);

  return normalizedAliases.some(alias => packageText.some(value => value.includes(alias)));
}
