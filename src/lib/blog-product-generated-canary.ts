import type { AngleType } from './content-generator';
import type { BlogGeneratedQualityCanaryRow } from './blog-canary-generated-quality';
import { buildProductBlogBrief } from './blog-product-brief';
import { generateProductConsultantBlogPost } from './blog-product-consultant-writer';

type ProductCanaryQueueRow = {
  id?: string | null;
  product_id?: string | null;
  destination?: string | null;
  angle_type?: string | null;
  topic?: string | null;
  status?: string | null;
};

type ProductCanaryPackage = {
  id: string;
  title?: string | null;
  display_title?: string | null;
  destination?: string | null;
  duration?: number | null;
  nights?: number | null;
  price?: number | null;
  departure_airport?: string | null;
  airline?: string | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
  itinerary?: string[] | null;
  itinerary_data?: { days?: unknown[] } | null;
  product_highlights?: string[] | null;
  optional_tours?: Array<{ name?: string | null; price_usd?: number | null }> | null;
  land_operator?: string | null;
  land_operator_id?: string | null;
  supplier_code?: string | null;
  internal_code?: string | null;
  price_dates?: unknown;
  price_tiers?: unknown;
  price_list?: unknown;
  confirmed_dates?: unknown;
  ticketing_deadline?: string | null;
};

const ANGLES = new Set<AngleType>(['value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food']);

function normalizeAngle(value: unknown): AngleType {
  return typeof value === 'string' && ANGLES.has(value as AngleType) ? value as AngleType : 'value';
}

function slugPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function buildProductGeneratedCanaryRows(input: {
  queueRows: ProductCanaryQueueRow[];
  products: ProductCanaryPackage[];
  limit?: number;
}): BlogGeneratedQualityCanaryRow[] {
  const productById = new Map(input.products.map((product) => [String(product.id), product]));
  const selected: BlogGeneratedQualityCanaryRow[] = [];
  const seen = new Set<string>();
  const limit = Math.max(1, Math.min(5, Math.round(input.limit ?? 2)));

  for (const row of input.queueRows) {
    if (selected.length >= limit) break;
    if (!row.product_id || seen.has(row.product_id)) continue;
    const product = productById.get(row.product_id);
    if (!product) continue;

    const brief = buildProductBlogBrief(product, normalizeAngle(row.angle_type));
    const markdown = generateProductConsultantBlogPost(product, brief);
    const productTitle = product.title || product.display_title || row.topic || '상품 카나리';
    const slug = `product-canary-${slugPart(product.id) || selected.length + 1}`;

    seen.add(row.product_id);
    selected.push({
      id: `dry-run:${row.id ?? product.id}`,
      slug,
      seo_title: productTitle,
      blog_html: `${markdown}\n\n<!-- generated_canary: dry_run -->`,
      destination: product.destination || row.destination || null,
      primary_keyword: brief.primary_keyword,
      content_type: 'package_intro',
      product_id: product.id,
      generation_meta: {
        writer: 'product_consultant_writer',
        prompt_version: brief.prompt_version,
        product_consult_brief: brief,
        content_brief: {
          title: brief.product_title,
          primary_keyword: brief.primary_keyword,
          search_intent: 'commercial_package_comparison',
          evidence: ['product_db'],
          product: brief,
        },
        generated_canary: {
          mode: 'dry_run',
          queue_id: row.id ?? null,
          source: 'blog_topic_queue + travel_packages',
        },
      },
    });
  }

  return selected;
}
