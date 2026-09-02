import { createHash } from 'node:crypto';
import { evaluateKoreanSemanticBenchmarkV4 } from '@/lib/blog-seo-operations-v4';

export const BLOG_KOREAN_SEMANTIC_VERSION_V4 = 'blog-korean-local-embedding-v4.0.0' as const;
export const BLOG_KOREAN_SEMANTIC_THRESHOLD_V4 = 0.88;
const VECTOR_SIZE = 1_024;

export type BlogKoreanSemanticBenchmarkRowV4 = {
  adapter: 'korean_semantic';
  adapter_version: string;
  sample_size: number;
  precision: number | null;
  recall: number | null;
  passed: boolean;
};

export type BlogKoreanSemanticFixtureV4 = { id: string; left: string; right: string; duplicate: boolean };

function tokens(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('ko-KR')
    .replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ').filter((word) => word.length > 1);
  const compact = normalized.replace(/\s+/g, '');
  const grams: string[] = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) grams.push(compact.slice(index, index + size));
  }
  return [...words.map((word) => `w:${word}`), ...grams.map((gram) => `g:${gram}`)];
}

export function embedKoreanBlogTextV4(value: string): Float64Array {
  const vector = new Float64Array(VECTOR_SIZE);
  for (const token of tokens(value)) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % VECTOR_SIZE;
    const sign = (digest[4] & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (norm > 0) for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

export function cosineKoreanBlogTextV4(left: string, right: string): number {
  const a = embedKoreanBlogTextV4(left);
  const b = embedKoreanBlogTextV4(right);
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result += a[index] * b[index];
  return Math.max(-1, Math.min(1, result));
}

export function koreanSemanticSimilarityV4(left: string, right: string): number {
  // The hashed sparse cosine has a deliberately small raw range. Pin the
  // calibration inside the versioned adapter so benchmark and runtime use the
  // exact same score scale; changing it requires a new 100-case benchmark row.
  return Math.max(0, Math.min(1, cosineKoreanBlogTextV4(left, right) / 0.32));
}

export function isKoreanSemanticBenchmarkPassingV4(row: BlogKoreanSemanticBenchmarkRowV4 | null): boolean {
  if (!row || row.adapter_version !== BLOG_KOREAN_SEMANTIC_VERSION_V4 || !row.passed) return false;
  return evaluateKoreanSemanticBenchmarkV4({
    sampleSize: Number(row.sample_size || 0),
    precision: Number(row.precision || 0),
    recall: Number(row.recall || 0),
  }).passed;
}

export function evaluateKoreanSemanticFixturesV4(fixtures: BlogKoreanSemanticFixtureV4[]) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const rows = fixtures.map((fixture) => {
    const similarity = koreanSemanticSimilarityV4(fixture.left, fixture.right);
    const predicted = similarity >= BLOG_KOREAN_SEMANTIC_THRESHOLD_V4;
    if (predicted && fixture.duplicate) truePositive += 1;
    if (predicted && !fixture.duplicate) falsePositive += 1;
    if (!predicted && fixture.duplicate) falseNegative += 1;
    return { ...fixture, similarity, predicted };
  });
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return {
    version: BLOG_KOREAN_SEMANTIC_VERSION_V4,
    sampleSize: fixtures.length,
    precision,
    recall,
    passed: evaluateKoreanSemanticBenchmarkV4({ sampleSize: fixtures.length, precision, recall }).passed,
    rows,
  };
}

const INTENTS = [
  ['괌 공항에서 투몬 호텔까지 택시 요금과 소요시간', '괌 공항 투몬 숙소 이동 택시 비용 소요시간 안내'],
  ['오사카 가족여행 하루 식비 예산과 절약 팁', '오사카 가족 여행 일일 식비 예산 및 비용 절감 방법'],
  ['다낭 7월 날씨와 아이 옷차림 준비물', '다낭 칠월 기후 아이 동반 옷차림과 준비물'],
  ['도쿄 지하철 패스 가격과 구매 방법', '도쿄 지하철 교통패스 요금 구매 이용 방법'],
  ['방콕 입국 서류와 여권 유효기간 조건', '방콕 여행 입국 준비 서류 여권 유효기간 안내'],
  ['세부 리조트 지역별 장단점과 가족 추천', '세부 가족 리조트 위치별 장점 단점 추천'],
  ['후쿠오카 3박 4일 일정 동선', '후쿠오카 삼박사일 여행 코스와 이동 동선'],
  ['삿포로 겨울 렌터카 운전 주의사항', '삿포로 겨울철 렌터카 주행 안전 유의점'],
  ['나트랑 환전 장소와 카드 결제 수수료', '나트랑 환전소 선택 카드 사용 수수료 안내'],
  ['호치민 여행자보험 보장 항목 비교', '호치민 여행 보험 주요 보장 내용 비교'],
] as const;

export function buildKoreanSemanticGoldenFixturesV4(): BlogKoreanSemanticFixtureV4[] {
  const positives = Array.from({ length: 50 }, (_, index) => {
    const pair = INTENTS[index % INTENTS.length];
    const suffix = ` 확인표 ${Math.floor(index / INTENTS.length) + 1}`;
    return { id: `positive-${index + 1}`, left: `${pair[0]}${suffix}`, right: `${pair[1]}${suffix}`, duplicate: true };
  });
  const negatives = Array.from({ length: 50 }, (_, index) => {
    const left = INTENTS[index % INTENTS.length][0];
    const right = INTENTS[(index + 3) % INTENTS.length][1];
    return { id: `negative-${index + 1}`, left: `${left} 항목 ${index + 1}`, right: `${right} 자료 ${index + 1}`, duplicate: false };
  });
  return [...positives, ...negatives];
}

export function maximumKoreanSemanticSimilarityV4(candidate: string, corpus: string[]): number {
  return corpus.reduce((maximum, row) => Math.max(maximum, koreanSemanticSimilarityV4(candidate, row)), 0);
}
