/**
 * Programmatic SEO — /things-to-do/[region]
 *
 * 패턴: Booking.com / Klook 스타일 — DB 의 (region, attractions, travel_packages)
 * 매트릭스를 기반으로 ISR 정적 페이지를 자동 생성. SaaS 추가 비용 0원.
 *
 * 동작:
 *   - generateStaticParams: 활성 region 전부를 빌드 시점에 생성
 *   - revalidate: 1일 (콘텐츠 갱신은 /api/revalidate 로 즉시 무효화 가능)
 *   - 카테고리(자연·문화·먹거리·쇼핑)별 그룹핑 + 관련 패키지 + Pillar 글 링크
 *
 * cacheTag: `things-to-do:${region}` — orchestrator/blog-publisher 가 발행 후 무효화
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { pickAttractionPhotoUrl, isSafeImageSrc } from '@/lib/image-url';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

export const revalidate = 86400; // 1d
export const dynamicParams = true;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

const CATEGORY_LABELS: Record<string, string> = {
  sightseeing: '관광·명소',
  nature: '자연·풍경',
  culture: '문화·역사',
  food: '먹거리',
  shopping: '쇼핑',
  activity: '액티비티',
  experience: '체험',
  beach: '해변·바다',
  museum: '박물관·전시',
};

interface AttractionRow {
  id: string;
  name: string;
  short_desc: string | null;
  long_desc: string | null;
  category: string | null;
  badge_type: string | null;
  photos: Array<{ src_medium?: string; src_large?: string }> | null;
  emoji: string | null;
  region: string;
}

interface PackageRow {
  id: string;
  title: string;
  destination: string | null;
  duration: number | null;
  nights: number | null;
  price: number | null;
  airline: string | null;
  photos: Array<{ src_medium?: string; src_large?: string }> | null;
  photo_urls: string[] | null;
}

interface PageData {
  region: string;
  attractionsByCategory: Record<string, AttractionRow[]>;
  packages: PackageRow[];
  totalAttractions: number;
}

function pickPackageCoverUrl(p: PackageRow): string | null {
  const fromPhotos = pickAttractionPhotoUrl(p.photos);
  if (fromPhotos) return fromPhotos;
  const raw = p.photo_urls?.[0];
  return isSafeImageSrc(raw) ? raw.trim() : null;
}

export async function generateStaticParams() {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('attractions')
    .select('region')
    .not('region', 'is', null);
  if (!data) return [];
  const set = new Set<string>();
  for (const r of data) {
    if (r.region) set.add(r.region);
  }
  return Array.from(set).map((region) => ({ region: encodeURIComponent(region) }));
}

async function getPageData(regionRaw: string): Promise<PageData | null> {
  if (!isSupabaseConfigured) return null;
  const region = decodeURIComponent(regionRaw);

  const [{ data: attractions }, { data: packages }] = await Promise.all([
    supabaseAdmin
      .from('attractions')
      .select('id, name, short_desc, long_desc, category, badge_type, photos, emoji, region')
      .eq('region', region)
      .order('mention_count', { ascending: false })
      .limit(60),
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, nights, price, airline, photos, photo_urls, status')
      .eq('destination', region)
      .in('status', ['approved', 'active'])
      .order('price', { ascending: true })
      .limit(8),
  ]);

  if (!attractions || attractions.length === 0) return null;

  const grouped: Record<string, AttractionRow[]> = {};
  for (const a of attractions as AttractionRow[]) {
    const cat = a.category ?? 'sightseeing';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(a);
  }

  return {
    region,
    attractionsByCategory: grouped,
    packages: (packages ?? []) as PackageRow[],
    totalAttractions: attractions.length,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ region: string }> }): Promise<Metadata> {
  const { region: regionRaw } = await params;
  const region = decodeURIComponent(regionRaw);
  const data = await getPageData(regionRaw);
  const count = data?.totalAttractions ?? 0;
  const title = `${region} 가볼만한 곳 ${count}곳 — 카테고리별 정리 | 여소남`;
  const description = `${region} 여행 시 꼭 가봐야 할 명소 ${count}곳을 카테고리(자연·문화·먹거리·쇼핑)별로 정리. 운영팀이 검증한 추천 일정과 패키지까지 한 페이지에서.`;
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/things-to-do/${encodeURIComponent(region)}` },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/things-to-do/${encodeURIComponent(region)}`,
      type: 'website',
      images: data?.attractionsByCategory ? Object.values(data.attractionsByCategory).flat().slice(0, 1).map(a => ({
        url: a.photos?.[0]?.src_large ?? a.photos?.[0]?.src_medium ?? `${BASE_URL}/og-default.png`,
      })) : undefined,
    },
  };
}

export default async function ThingsToDoRegionPage({ params }: { params: Promise<{ region: string }> }) {
  const { region: regionRaw } = await params;
  const data = await getPageData(regionRaw);
  if (!data) notFound();

  const orderedCategories = Object.keys(data.attractionsByCategory).sort((a, b) => {
    return data.attractionsByCategory[b].length - data.attractionsByCategory[a].length;
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <nav className="mb-2 text-xs text-neutral-500">
          <Link href="/" className="hover:underline">홈</Link>
          <span className="mx-1">›</span>
          <Link href="/things-to-do" className="hover:underline">여행지별 명소</Link>
          <span className="mx-1">›</span>
          <span>{data.region}</span>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">
          {data.region} 가볼만한 곳 <span className="text-orange-600">{data.totalAttractions}곳</span>
        </h1>
        <p className="mt-2 text-neutral-600">
          여소남 운영팀이 직접 검증한 {data.region} 여행 명소를 카테고리별로 정리했습니다.
          관광·자연·먹거리·쇼핑까지 한 페이지에서 비교하고, 마음에 드는 곳이 있다면 운영팀이 엄선한 패키지로 바로 떠날 수 있습니다.
        </p>
      </header>

      {/* 카테고리별 명소 */}
      {orderedCategories.map((cat) => {
        const items = data.attractionsByCategory[cat];
        const label = CATEGORY_LABELS[cat] ?? cat;
        return (
          <section key={cat} className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">
              {label} <span className="text-sm font-normal text-neutral-500">{items.length}곳</span>
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => {
                const photo = pickAttractionPhotoUrl(a.photos);
                return (
                  <article key={a.id} className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                    {photo ? (
                      <SafeCoverImg
                        src={photo}
                        alt={a.name}
                        loading="lazy"
                        className="h-40 w-full object-cover"
                        fallback={<div className="h-40 w-full bg-neutral-100" aria-hidden />}
                      />
                    ) : null}
                    <div className="p-4">
                      <h3 className="font-semibold">
                        {a.emoji && <span className="mr-1">{a.emoji}</span>}
                        {a.name}
                        {a.badge_type && a.badge_type !== 'tour' && (
                          <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-700">
                            {a.badge_type}
                          </span>
                        )}
                      </h3>
                      {a.short_desc && (
                        <p className="mt-1 text-sm text-neutral-600 line-clamp-2">{a.short_desc}</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* 관련 패키지 */}
      {data.packages.length > 0 && (
        <section className="mb-10 rounded-lg bg-neutral-50 p-6">
          <h2 className="mb-4 text-xl font-semibold">{data.region} 추천 패키지</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.packages.map((p) => (
              <Link
                key={p.id}
                href={`/packages/${p.id}`}
                className="block overflow-hidden rounded-lg border border-neutral-200 bg-white hover:shadow-md transition-shadow"
              >
                {(() => {
                  const cover = pickPackageCoverUrl(p);
                  return cover ? (
                    <SafeCoverImg
                      src={cover}
                      alt={p.title}
                      loading="lazy"
                      className="h-32 w-full object-cover"
                      fallback={<div className="h-32 w-full bg-neutral-100" aria-hidden />}
                    />
                  ) : null;
                })()}
                <div className="p-3">
                  <h3 className="text-sm font-semibold line-clamp-2">{p.title}</h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                    {p.airline && <span>{p.airline}</span>}
                    {p.nights && p.duration && <span>{p.nights}박 {p.duration}일</span>}
                  </div>
                  {p.price && (
                    <div className="mt-2 text-base font-bold text-orange-600">
                      {Math.floor(p.price / 10000)}만원~
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* JSON-LD: ItemList for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: `${data.region} 가볼만한 곳`,
            numberOfItems: data.totalAttractions,
            itemListElement: Object.values(data.attractionsByCategory).flat().slice(0, 20).map((a, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: a.name,
              description: a.short_desc ?? undefined,
            })),
          }),
        }}
      />
    </main>
  );
}
