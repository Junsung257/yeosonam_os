/**
 * @file few-shot-retriever.ts — EPR (Efficient Prompt Retrieval, Rubin et al. NAACL 2022)
 *
 * 신규 등록 원문 → embedding → 기존 활성 패키지 중 cosine top-K 검색 → demo 로 prompt 에 주입.
 * 사장님이 정정한 케이스가 누적될수록 검색 demo 풀이 풍부해져 다음 추출이 자동으로 똑똑해짐
 *  → 진짜 compound improvement.
 *
 * 인프라 재활용:
 *   - travel_packages.embedding (vector(1536), HNSW 인덱스) — 이미 존재
 *   - search_travel_packages_semantic RPC — 이미 존재
 *   - embedText() — Gemini gemini-embedding-001 1536d
 *
 * 학술 근거: arXiv 2112.08633 (Rubin/Herzig/Berant NAACL 2022)
 *   - dense retriever 로 prompt-augmenting demo 동적 선택
 *   - cosine top-K 가 random/BM25 보다 일관되게 우월
 */

import { embedText } from './embeddings';

export interface SimilarExample {
  id: string;
  title: string;
  destination: string | null;
  duration: number | null;
  similarity: number;
  rawTextSnippet: string;            // 원문 앞 1500자
  metaSummary: string;                // 핵심 추출 결과 한 줄 요약
}

export interface RetrieveOptions {
  limit?: number;
  minSimilarity?: number;
  excludePackageIds?: string[];        // 자기 자신·archived·실패 케이스 제외용
}

/**
 * 신규 raw_text 와 가장 유사한 등록 성공 패키지 top-K 회수.
 *
 * 사용 흐름 (`normalize-with-llm.ts`):
 *   1. retrieveSimilarExamples(rawText) → 3-5개 demo
 *   2. SYSTEM_PROMPT (cached) + few_shot_examples (가변) + 실제 원문 (가변)
 *   3. LLM 이 demo 패턴 학습 → 동일 랜드사·지역 처리 일관성 ↑
 */
export async function retrieveSimilarExamples(
  rawText: string,
  supabaseClient: {
    rpc: <T = unknown>(
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: T; error: unknown }>;
    from: (table: string) => {
      select: (columns: string) => {
        in: <T = unknown>(column: string, values: string[]) => Promise<{ data: T; error?: unknown }>;
      };
    };
  },
  apiKey: string,
  options: RetrieveOptions = {},
): Promise<SimilarExample[]> {
  const { limit = 4, minSimilarity = 0.55, excludePackageIds = [] } = options;
  if (!rawText || rawText.length < 50) return [];
  if (!apiKey) return [];

  // 1. 신규 원문 → embedding (RETRIEVAL_QUERY 비대칭)
  const queryEmb = await embedText(rawText, apiKey, 'RETRIEVAL_QUERY');
  if (!queryEmb) return [];

  // 2. cosine top-K (HNSW 인덱스 사용)
  //    excludePackageIds 처리 위해 limit 을 넉넉하게 가져온 뒤 필터
  const fetchLimit = limit + excludePackageIds.length + 5;
  const { data: hits, error } = await supabaseClient.rpc<Array<{ package_id: string; title: string; destination: string; duration: number; similarity: number }>>('search_travel_packages_semantic', {
    query_embedding: queryEmb,
    match_limit: fetchLimit,
    min_similarity: minSimilarity,
  });
  if (error || !Array.isArray(hits) || hits.length === 0) return [];

  const filteredHits = hits
    .filter((h: { package_id: string }) => !excludePackageIds.includes(h.package_id))
    .slice(0, limit);
  if (filteredHits.length === 0) return [];

  // 3. raw_text + 핵심 메타 한꺼번에 조회
  const ids = filteredHits.map((h: { package_id: string }) => h.package_id);
  const { data: pkgs } = await supabaseClient
    .from('travel_packages')
    .select('id, title, destination, duration, country, airline, departure_airport, departure_days, raw_text, accommodations, itinerary_data')
    .in<Array<{
      id: string;
      title: string;
      destination: string | null;
      duration: number | null;
      country: string | null;
      airline: string | null;
      departure_airport: string | null;
      departure_days: string | null;
      raw_text: string | null;
      accommodations: string[] | null;
      itinerary_data: { meta?: { flight_out?: string; flight_in?: string } } | null;
    }>>('id', ids);

  const pkgMap = new Map<string, {
    id: string;
    title: string;
    destination: string | null;
    duration: number | null;
    country: string | null;
    airline: string | null;
    departure_airport: string | null;
    departure_days: string | null;
    raw_text: string | null;
    accommodations: string[] | null;
    itinerary_data: { meta?: { flight_out?: string; flight_in?: string } } | null;
  }>();
  for (const p of (pkgs || [])) pkgMap.set(p.id, p);

  // 4. SimilarExample 형식으로 빌드
  return filteredHits.map((hit: { package_id: string; title: string; destination: string; duration: number; similarity: number }) => {
    const pkg = pkgMap.get(hit.package_id);
    const flightOut = pkg?.itinerary_data?.meta?.flight_out || '?';
    const flightIn = pkg?.itinerary_data?.meta?.flight_in || '?';
    const hotel = pkg?.accommodations?.[0] || '?';

    const metaSummary = [
      `destination=${pkg?.destination || hit.destination}`,
      pkg?.country ? `country=${pkg.country}` : null,
      `duration=${pkg?.duration || hit.duration}일`,
      pkg?.airline ? `airline=${pkg.airline}` : null,
      pkg?.departure_airport ? `dep=${pkg.departure_airport}` : null,
      pkg?.departure_days ? `dow=${pkg.departure_days}` : null,
      flightOut !== '?' ? `flight_out=${flightOut}` : null,
      flightIn !== '?' ? `flight_in=${flightIn}` : null,
      hotel !== '?' ? `hotel=${hotel}` : null,
    ].filter(Boolean).join(' / ');

    return {
      id: hit.package_id,
      title: hit.title,
      destination: pkg?.destination || hit.destination,
      duration: pkg?.duration || hit.duration,
      similarity: Number(hit.similarity || 0),
      rawTextSnippet: (pkg?.raw_text || '').slice(0, 1500),
      metaSummary,
    };
  });
}

/**
 * normalize-with-llm.ts 에서 사용할 prompt fragment 빌더.
 * 토큰 효율 위해 demo 당 max 1500자 raw + 1줄 메타.
 *
 * 결과 예:
 * ## 유사 등록 사례 (참고용 — 정규화 패턴 학습 목적)
 *
 * ### [1] 보홀 3박5일 — similarity 0.87
 * 메타: destination=보홀 / country=필리핀 / duration=5일 / airline=7C / flight_out=7C2157 / hotel=헤난 타왈라
 * 원문 일부:
 * ```
 * ★스팟특가★ 부산出 보홀 PKG 5/6일 일정표 [제주항공7C]
 * ...
 * ```
 *
 * ### [2] ...
 */
export function buildFewShotPromptFragment(examples: SimilarExample[]): string {
  if (examples.length === 0) return '';

  const blocks = examples.map((ex, i) => {
    return [
      `### [${i + 1}] ${ex.title} — similarity ${ex.similarity.toFixed(2)}`,
      `메타: ${ex.metaSummary}`,
      '원문 일부:',
      '```',
      ex.rawTextSnippet,
      '```',
    ].join('\n');
  });

  return [
    '## 유사 등록 사례 (참고용 — 정규화 패턴 학습 목적)',
    '',
    '아래는 과거에 동일 시스템에서 성공적으로 정규화된 원문 사례입니다.',
    '각 사례의 메타(destination/airline/flight_out/hotel)가 어떻게 추출됐는지 패턴을 참고하되,',
    '실제 정규화는 반드시 **이번 원문**의 사실에만 기반하세요. 사례 메타를 그대로 복사 금지.',
    '',
    ...blocks,
    '',
    '---',
    '',
  ].join('\n');
}
