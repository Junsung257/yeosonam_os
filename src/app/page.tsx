'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const COUNTRY_EMOJI: Record<string, string> = {
  '베트남': '\uD83C\uDDFB\uD83C\uDDF3', '중국': '\uD83C\uDDE8\uD83C\uDDF3',
  '일본': '\uD83C\uDDEF\uD83C\uDDF5', '필리핀': '\uD83C\uDDF5\uD83C\uDDED',
  '말레이시아': '\uD83C\uDDF2\uD83C\uDDFE', '태국': '\uD83C\uDDF9\uD83C\uDDED',
  '인도네시아': '\uD83C\uDDEE\uD83C\uDDE9', '캄보디아': '\uD83C\uDDF0\uD83C\uDDED',
  '대만': '\uD83C\uDDF9\uD83C\uDDFC', '몽골': '\uD83C\uDDF2\uD83C\uDDF3',
  '홍콩': '\uD83C\uDDED\uD83C\uDDF0', '마카오': '\uD83C\uDDF2\uD83C\uDDF4',
  '싱가포르': '\uD83C\uDDF8\uD83C\uDDEC', '라오스': '\uD83C\uDDF1\uD83C\uDDE6',
};

// 목적지 → 국가 매핑 (country 없는 경우 fallback)
function guessCountry(dest: string): string {
  if (/나트랑|다낭|하노이|푸꾸옥|호치민|달랏/.test(dest)) return '베트남';
  if (/장가계|청도|서안|상해|연길|백두산|구채구/.test(dest)) return '중국';
  if (/시즈오카|후쿠오카|오사카|도쿄|큐슈|토야마|후지노미야/.test(dest)) return '일본';
  if (/보홀|세부|마닐라/.test(dest)) return '필리핀';
  if (/코타키나발루|말라카/.test(dest)) return '말레이시아';
  if (/방콕|치앙마이|푸켓|파타야/.test(dest)) return '태국';
  if (/발리/.test(dest)) return '인도네시아';
  if (/마카오/.test(dest)) return '마카오';
  if (/마나도/.test(dest)) return '인도네시아';
  return '';
}

interface Destination {
  destination: string;
  count: number;
  minPrice: number;
  country: string;
  image?: string;
}

export default function HomePage() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // 1단계: 목적지 목록 먼저 표시 (빠름)
        const res = await fetch('/api/packages?aggregate=destination');
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        const dests: Destination[] = (data.destinations || []).map((d: any) => ({
          ...d,
          country: (d.country && d.country.trim()) ? d.country.trim() : guessCountry(d.destination),
        }));
        setDestinations(dests);
        setLoading(false);

        // 2단계: 이미지는 비동기로 나중에 채움 (느려도 UI 블로킹 없음)
        try {
          const attrRes = await fetch('/api/attractions?photos_only=1');
          if (attrRes.ok) {
            const attrData = await attrRes.json();
            const attractions: any[] = attrData.attractions || [];
            const usedPhotoIds = new Set<number>();

            const updatedDests = dests.map(dest => {
              try {
                const destParts = dest.destination.split(/[\/,\s]/).map((s: string) => s.trim()).filter(Boolean);
                const matched = attractions
                  .filter((a: any) => {
                    if (!a.photos || a.photos.length === 0) return false;
                    const aRegion = a.region || '';
                    const aCountry = a.country || '';
                    return destParts.some((part: string) =>
                      aRegion === part || aRegion.includes(part) || part.includes(aRegion) ||
                      aCountry.includes(part) || dest.destination.includes(aRegion)
                    );
                  })
                  .sort((a: any, b: any) => (b.mention_count || 0) - (a.mention_count || 0));

                const unused = matched.find((a: any) => {
                  const photoId = a.photos[0]?.pexels_id;
                  return photoId && !usedPhotoIds.has(photoId);
                });
                const chosen = unused || matched[0];
                if (chosen?.photos?.[0]) {
                  const image = chosen.photos[0].src_large || chosen.photos[0].src_medium || '';
                  if (chosen.photos[0].pexels_id) usedPhotoIds.add(chosen.photos[0].pexels_id);
                  return { ...dest, image };
                }
              } catch { /* skip */ }
              return dest;
            });
            setDestinations(updatedDests);
          }
        } catch { /* attractions fetch failed — images just won't load */ }
      } catch (err) {
        console.error('홈페이지 로드 실패:', err);
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-white max-w-lg mx-auto">
      {/* 히어로 */}
      <div className="bg-gradient-to-b from-[#340897] to-[#4b2ead] px-5 pt-10 pb-8 text-center">
        {/* 김해공항 배지 */}
        <div className="inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1 mb-3">
          <span className="text-white text-sm font-medium">✈ 김해공항 출발 전용</span>
        </div>

        <h1 className="text-white text-2xl font-black tracking-tight">여소남</h1>
        <p className="text-white/70 text-sm mt-1 font-medium">가치있는 여행을 소개합니다</p>

        {/* 테마 필터 칩 */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 mt-5 justify-center flex-wrap">
          {['전체', '중국', '일본', '동남아', '마카오/홍콩', '인천출발'].map(region => (
            <Link
              key={region}
              href={region === '전체' ? '/packages' : `/packages?filter=${encodeURIComponent(region)}`}
              className="flex-shrink-0 bg-white/20 text-white text-sm px-3.5 py-2 rounded-full border border-white/30 active:bg-white/30 transition"
            >
              {region}
            </Link>
          ))}
        </div>
      </div>

      {/* 목적지 카드 그리드 */}
      <div className="px-4 -mt-6">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4">
          <h2 className="text-base font-bold text-gray-800 mb-3">인기 여행지</h2>

          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl overflow-hidden border border-gray-100">
                  <div className="h-28 bg-gray-200 animate-pulse" />
                  <div className="px-2.5 py-2">
                    <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : destinations.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-base">현재 판매 중인 상품이 없습니다</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {destinations.map((dest, index) => {
                const emoji = COUNTRY_EMOJI[dest.country] || '🌍';
                return (
                  <Link key={dest.destination} href={`/packages?destination=${encodeURIComponent(dest.destination)}`}>
                    <div className="group relative rounded-xl overflow-hidden border border-gray-100 hover:border-violet-300 hover:shadow-md transition-all cursor-pointer">
                      {/* 이미지 */}
                      <div className="relative h-28 bg-gray-100">
                        {dest.image ? (
                          <Image src={dest.image} alt={dest.destination} fill sizes="(max-width: 512px) 50vw, 256px" className="object-cover group-hover:scale-105 transition-transform duration-300" {...(index < 2 ? { priority: true } : { loading: 'lazy' as const })} />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center text-3xl">{emoji}</div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                        <div className="absolute bottom-2 left-2.5">
                          <p className="text-white text-base font-bold leading-tight">{emoji} {dest.destination}</p>
                        </div>
                        <div className="absolute top-2 right-2">
                          <span className="bg-white/90 text-xs font-bold text-violet-700 px-2 py-0.5 rounded-full">{dest.count}개</span>
                        </div>
                      </div>
                      {/* 가격 */}
                      <div className="px-2.5 py-2">
                        <p className="text-base font-black text-gray-900">
                          {dest.minPrice > 0 ? `₩${dest.minPrice.toLocaleString()}~` : '가격 문의'}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 하단 안내 */}
      <div className="px-6 py-8 text-center">
        <p className="text-sm text-gray-400">부산/김해 출발 단체·패키지 여행 전문</p>
        <p className="text-xs text-gray-300 mt-1">yeosonam.co.kr</p>
      </div>

      {/* 플로팅 CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-50 border-t border-gray-100 safe-area-bottom">
        <div className="max-w-lg mx-auto px-4 pb-5 pt-3 flex items-center gap-3">
          <a href="tel:051-000-0000" className="w-12 h-12 flex items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50 shrink-0">
            <span className="text-lg">📞</span>
          </a>
          <a href="https://pf.kakao.com/_xcFxkBG/chat" target="_blank" rel="noopener" referrerPolicy="no-referrer-when-downgrade"
            className="flex-1 bg-[#FEE500] h-12 rounded-full text-[#3C1E1E] font-bold text-base flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all">
            💬 카카오톡 상담
          </a>
        </div>
      </div>
    </div>
  );
}
