/**
 * @file multilingual-photo.ts — Pexels 영문 + 지역어 동시 검색 (2026-05-14 박제, 사장님 비전 V5)
 *
 * 사장님 정책: 정확한 attraction 사진을 위해 영문 + 지역어(현지 언어) 양쪽 검색.
 *   - "Bana Hills Vietnam" (영문)
 *   - "Bà Nà Hills" (베트남어)
 *   - 동시 검색 → 결과 합치고 vision 검증 (선택)
 *
 * Pexels supports locale parameter (ko-KR, ja-JP, vi-VN, th-TH, zh-CN, ...).
 */

import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

interface PexelsResult {
  url: string;
  photographer?: string;
  pexels_id?: number;
  src: { medium: string; large: string };
}

/** destination 한국어 → 영문 + 지역어 매핑 (자주 등록되는 국가) */
const DEST_TO_LOCALE: Record<string, { lang: string; native: string; locale: string }> = {
  '베트남': { lang: 'vi', native: 'Vietnam', locale: 'vi-VN' },
  '하노이': { lang: 'vi', native: 'Hà Nội', locale: 'vi-VN' },
  '다낭': { lang: 'vi', native: 'Đà Nẵng', locale: 'vi-VN' },
  '나트랑': { lang: 'vi', native: 'Nha Trang', locale: 'vi-VN' },
  '호치민': { lang: 'vi', native: 'Hồ Chí Minh', locale: 'vi-VN' },
  '푸꾸옥': { lang: 'vi', native: 'Phú Quốc', locale: 'vi-VN' },
  '바나힐스': { lang: 'vi', native: 'Bà Nà Hills', locale: 'vi-VN' },

  '일본': { lang: 'ja', native: 'Japan', locale: 'ja-JP' },
  '도쿄': { lang: 'ja', native: '東京', locale: 'ja-JP' },
  '오사카': { lang: 'ja', native: '大阪', locale: 'ja-JP' },
  '교토': { lang: 'ja', native: '京都', locale: 'ja-JP' },
  '후쿠오카': { lang: 'ja', native: '福岡', locale: 'ja-JP' },
  '삿포로': { lang: 'ja', native: '札幌', locale: 'ja-JP' },
  '오키나와': { lang: 'ja', native: '沖縄', locale: 'ja-JP' },

  '태국': { lang: 'th', native: 'Thailand', locale: 'th-TH' },
  '방콕': { lang: 'th', native: 'กรุงเทพ', locale: 'th-TH' },
  '치앙마이': { lang: 'th', native: 'เชียงใหม่', locale: 'th-TH' },
  '푸켓': { lang: 'th', native: 'ภูเก็ต', locale: 'th-TH' },

  '중국': { lang: 'zh', native: 'China', locale: 'zh-CN' },
  '북경': { lang: 'zh', native: '北京', locale: 'zh-CN' },
  '상해': { lang: 'zh', native: '上海', locale: 'zh-CN' },
  '서안': { lang: 'zh', native: '西安', locale: 'zh-CN' },
  '장가계': { lang: 'zh', native: '张家界', locale: 'zh-CN' },
  '계림': { lang: 'zh', native: '桂林', locale: 'zh-CN' },
  '황산': { lang: 'zh', native: '黄山', locale: 'zh-CN' },

  '대만': { lang: 'zh', native: 'Taiwan', locale: 'zh-TW' },
  '타이베이': { lang: 'zh', native: '台北', locale: 'zh-TW' },
  '가오슝': { lang: 'zh', native: '高雄', locale: 'zh-TW' },
};

/** native 표기 lookup. 매칭 안 되면 빈 문자열. */
export function getDestinationNative(dest: string): { native: string; locale: string } | null {
  const trimmed = (dest ?? '').trim();
  if (!trimmed) return null;
  for (const [kr, info] of Object.entries(DEST_TO_LOCALE)) {
    if (trimmed.includes(kr) || kr.includes(trimmed)) {
      return { native: info.native, locale: info.locale };
    }
  }
  return null;
}

/**
 * 영문 + 지역어 두 쿼리로 Pexels 검색 → 결과 합치고 중복 제거.
 * 영문 결과 + 지역어 결과를 6:4 비율 mix.
 */
export async function searchMultilingualPhotos(args: {
  englishKeyword: string;
  destinationKorean?: string;
  count?: number;
}): Promise<PexelsResult[]> {
  if (!isPexelsConfigured()) return [];
  const total = args.count ?? 5;
  const englishCount = Math.ceil(total * 0.6);
  const nativeCount = total - englishCount;

  const englishP = searchPexelsPhotos(args.englishKeyword, englishCount);
  const native = args.destinationKorean ? getDestinationNative(args.destinationKorean) : null;
  const nativeP = native
    ? searchPexelsPhotos(`${native.native} ${args.englishKeyword.split(' ').slice(-1)[0] ?? ''}`.trim(), nativeCount)
    : Promise.resolve([] as PexelsResult[]);

  const [eng, nat] = await Promise.all([englishP, nativeP]);
  // dedup by pexels_id or url
  const seen = new Set<string | number>();
  const out: PexelsResult[] = [];
  for (const p of [...eng, ...nat]) {
    const key = (p as { pexels_id?: number }).pexels_id ?? p.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= total) break;
  }
  return out;
}
