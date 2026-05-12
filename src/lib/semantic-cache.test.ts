/**
 * @file semantic-cache.test.ts
 * @description Semantic cache 헬퍼 동작 회귀 방지.
 *
 * 검증 포인트:
 *   1. SAFE_CACHE_TASKS 화이트리스트 외 task 는 캐시 우회 (자동 hit=false, store no-op)
 *   2. embedText 가 null 반환 시 (키 없음) 안전하게 우회
 *   3. withSemanticCache: hit 시 fn 미실행, miss 시 fn 실행 + 저장
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const embedTextMock = vi.fn();
const supabaseRpcMock = vi.fn();
const supabaseInsertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: supabaseInsertMock }));

vi.mock('@/lib/embeddings', () => ({ embedText: embedTextMock, EMBED_DIM: 1536 }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { rpc: supabaseRpcMock, from: fromMock },
  isSupabaseConfigured: true,
}));
vi.mock('@/lib/secret-registry', () => ({
  getSecret: (key: string) => (key === 'GEMINI_API_KEY' ? 'test-key' : null),
}));
// llm-gateway 는 무거운 의존성(Anthropic/OpenAI 초기화) → 가벼운 stub 으로 대체
vi.mock('@/lib/llm-gateway', () => ({}));

describe('redactPiiForStorage — 코드리뷰 fix', () => {
  it('전화번호 010-1234-5678 마스킹', async () => {
    const { redactPiiForStorage } = await import('./semantic-cache');
    expect(redactPiiForStorage('연락처 010-1234-5678 으로 연락주세요')).toContain('[전화]');
    expect(redactPiiForStorage('010 1234 5678')).toContain('[전화]');
    expect(redactPiiForStorage('01012345678')).toContain('[전화]');
  });

  it('이메일 마스킹', async () => {
    const { redactPiiForStorage } = await import('./semantic-cache');
    const r = redactPiiForStorage('user@example.com 으로 보내주세요');
    expect(r).toContain('[이메일]');
    expect(r).not.toContain('user@example.com');
  });

  it('카드/계좌/주민번호 마스킹', async () => {
    const { redactPiiForStorage } = await import('./semantic-cache');
    expect(redactPiiForStorage('1234-5678-9012-3456')).toContain('[카드]');
    expect(redactPiiForStorage('900101-1234567')).toContain('[주민번호]');
  });

  it('PII 없는 일반 텍스트는 그대로 통과', async () => {
    const { redactPiiForStorage } = await import('./semantic-cache');
    const text = '다낭 5박 6일 가족 여행 추천 부탁드립니다';
    expect(redactPiiForStorage(text)).toBe(text);
  });
});

describe('semantic-cache — 안전성 가드', () => {
  beforeEach(() => {
    embedTextMock.mockReset();
    supabaseRpcMock.mockReset();
    supabaseInsertMock.mockReset();
    fromMock.mockClear();
  });

  it('SAFE_CACHE_TASKS 외 task 는 lookup 즉시 hit=false 반환 (RPC 호출 없음)', async () => {
    const { lookupSemanticCache } = await import('./semantic-cache');
    const r = await lookupSemanticCache('extract-meta', 'hello');
    expect(r.hit).toBe(false);
    expect(supabaseRpcMock).not.toHaveBeenCalled();
    expect(embedTextMock).not.toHaveBeenCalled();
  });

  it('SAFE_CACHE_TASKS 외 task 는 store no-op (insert 호출 없음)', async () => {
    const { storeSemanticCache } = await import('./semantic-cache');
    await storeSemanticCache('extract-meta', 'q', 'r');
    expect(supabaseInsertMock).not.toHaveBeenCalled();
    expect(embedTextMock).not.toHaveBeenCalled();
  });

  it('embedText 실패(null) 시 lookup 안전 우회', async () => {
    embedTextMock.mockResolvedValue(null);
    const { lookupSemanticCache } = await import('./semantic-cache');
    const r = await lookupSemanticCache('parse_travel_doc', 'doc');
    expect(r.hit).toBe(false);
    expect(supabaseRpcMock).not.toHaveBeenCalled();
  });

  it('lookup 정상: RPC hit 시 hit=true + response 반환', async () => {
    embedTextMock.mockResolvedValue(new Array(1536).fill(0.1));
    supabaseRpcMock.mockImplementation((name: string) => {
      if (name === 'lookup_semantic_cache') {
        return Promise.resolve({
          data: [{ id: 'uuid-1', response: '{"x":1}', similarity: 0.99, hit_type: 'semantic' }],
          error: null,
        });
      }
      return { then: (cb: (v: { error: null }) => void) => cb({ error: null }) };
    });

    const { lookupSemanticCache } = await import('./semantic-cache');
    const r = await lookupSemanticCache('parse_travel_doc', 'sample document text');
    expect(r.hit).toBe(true);
    expect(r.response).toBe('{"x":1}');
    expect(r.hitType).toBe('semantic');
    expect(r.similarity).toBeCloseTo(0.99, 2);
  });

  it('withSemanticCache: hit 시 fn 미실행', async () => {
    embedTextMock.mockResolvedValue(new Array(1536).fill(0.1));
    supabaseRpcMock.mockImplementation((name: string) => {
      if (name === 'lookup_semantic_cache') {
        return Promise.resolve({
          data: [{ id: 'uuid-2', response: 'cached!', similarity: 1.0, hit_type: 'exact' }],
          error: null,
        });
      }
      return { then: (cb: (v: { error: null }) => void) => cb({ error: null }) };
    });

    const fn = vi.fn().mockResolvedValue('fresh!');
    const { withSemanticCache } = await import('./semantic-cache');
    const r = await withSemanticCache('parse_travel_doc', 'q', fn);
    expect(r.cached).toBe(true);
    expect(r.text).toBe('cached!');
    expect(fn).not.toHaveBeenCalled();
  });

  it('withSemanticCache: miss 시 fn 실행 + 결과 저장', async () => {
    embedTextMock.mockResolvedValue(new Array(1536).fill(0.1));
    supabaseRpcMock.mockResolvedValue({ data: [], error: null }); // miss
    supabaseInsertMock.mockResolvedValue({ error: null });

    const fn = vi.fn().mockResolvedValue('fresh response');
    const { withSemanticCache } = await import('./semantic-cache');
    const r = await withSemanticCache('parse_travel_doc', 'q', fn);
    expect(r.cached).toBe(false);
    expect(r.text).toBe('fresh response');
    expect(fn).toHaveBeenCalledTimes(1);

    // 저장은 fire-and-forget — 다음 tick 까지 대기
    await new Promise((res) => setTimeout(res, 10));
    expect(fromMock).toHaveBeenCalledWith('llm_semantic_cache');
    expect(supabaseInsertMock).toHaveBeenCalled();
  });
});
