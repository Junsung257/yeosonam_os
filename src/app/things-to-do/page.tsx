/**
 * /things-to-do — Programmatic SEO 인덱스 페이지
 *
 * 모든 활성 region 을 한 페이지에 카드 그리드로 노출 → /things-to-do/[region] 으로 분기.
 * 각 region 카드에 명소 수 + 대표 사진 표시.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { pickAttractionPhotoUrl } from '@/lib/image-url';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

export const revalidate = 86400; // 1d

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

interface RegionEntry {
  region: string;
  count: number;
  cover: string | null;
}

async function getRegions(): Promise<RegionEntry[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('attractions')
    .select('region, photos')
    .not('region', 'is', null)
    .order('mention_count', { ascending: false })
    .limit(2000);

  if (!data) return [];
  const map = new Map<string, RegionEntry>();
  for (const r of data) {
    if (!r.region) continue;
    if (!map.has(r.region)) {
      const photos = r.photos as Array<{ src_medium?: string; src_large?: string }> | null;
      map.set(r.region, {
        region: r.region,
        count: 0,
        cover: pickAttractionPhotoUrl(photos ?? undefined),
      });
    }
    const e = map.get(r.region)!;
    e.count += 1;
    if (!e.cover) {
      const photos = r.photos as Array<{ src_medium?: string; src_large?: string }> | null;
      const u = pickAttractionPhotoUrl(photos ?? undefined);
      if (u) e.cover = u;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export const metadata: Metadata = {
  title: '여행지별 가볼만한 곳 — 운영팀 검증 명소 | 여소남',
  description: '아시아·유럽·미주 인기 여행지의 가볼만한 곳을 카테고리별로 정리. 여소남 운영팀이 직접 답사하고 검증한 명소만 모아 보여드립니다.',
  alternates: { canonical: `${BASE_URL}/things-to-do` },
};

export default async function ThingsToDoIndexPage() {
  const regions = await getRegions();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">여행지별 가볼만한 곳</h1>
        <p className="mt-2 text-neutral-600">
          여소남 운영팀이 직접 답사·검증한 명소를 지역별로 모았습니다. 가고 싶은 도시를 선택하면 카테고리별(자연·문화·먹거리·쇼핑)로 정리된 추천 목록과 패키지를 함께 보실 수 있어요.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {regions.map((r) => (
          <Link
            key={r.region}
            href={`/things-to-do/${encodeURIComponent(r.region)}`}
            className="group overflow-hidden rounded-lg border border-neutral-200 bg-white transition-shadow hover:shadow-md"
          >
            <div className="relative h-32 w-full bg-neutral-100">
              {r.cover ? (
                <SafeCoverImg
                  src={r.cover}
                  alt={r.region}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  fallback={<div className="h-full w-full bg-neutral-200" aria-hidden />}
                />
              ) : null}
            </div>
            <div className="p-3">
              <div className="font-semibold">{r.region}</div>
              <div className="mt-0.5 text-xs text-neutral-500">{r.count}곳</div>
            </div>
          </Link>
        ))}
      </div>

      {regions.length === 0 && (
        <p className="mt-8 text-center text-neutral-500">아직 등록된 여행지가 없습니다.</p>
      )}
    </main>
  );
}
