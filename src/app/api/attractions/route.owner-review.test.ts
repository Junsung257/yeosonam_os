import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  insert: vi.fn(),
  existingIn: vi.fn(),
  savedIn: vi.fn(),
  resweep: vi.fn(),
  reenrich: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from: mocks.from,
  },
}));

vi.mock('@/lib/unmatched-resweep', () => ({
  resweepUnmatchedActivities: mocks.resweep,
}));

vi.mock('@/lib/package-reenrich-on-attraction-change', () => ({
  reEnrichAffectedPackages: mocks.reenrich,
}));

vi.mock('@/lib/secret-registry', () => ({
  getSecret: vi.fn(() => null),
}));

import { DELETE, PATCH, POST, PUT } from './route';

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/attractions', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      cookie: 'ys-dev-admin=1',
    },
    body: JSON.stringify(body),
  });
}

function setAttractionDbRows(options?: {
  existing?: Array<Record<string, unknown>>;
  saved?: Array<Record<string, unknown>>;
}): void {
  mocks.existingIn.mockResolvedValue({
    data: options?.existing ?? [],
    error: null,
  });
  mocks.savedIn.mockResolvedValue({
    data: options?.saved ?? [{ id: 'attr-new', name: '송찬림사' }],
    error: null,
  });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'attractions') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      select: vi.fn((fields: string) => ({
        in: fields === 'id, name' ? mocks.savedIn : mocks.existingIn,
      })),
      upsert: mocks.upsert,
    };
  });
}

function approvedItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: '송찬림사',
    short_desc: '운남 샹그릴라의 티베트 불교 사원',
    long_desc: '운남성 공식 관광 정보로 명칭과 위치를 확인했습니다.',
    country: '중국',
    region: '샹그릴라',
    badge_type: 'sightseeing',
    aliases: ['쑹찬린사', '송찬림사'],
    official_source_url: 'https://www.visityunnanchina.com/',
    supporting_source_urls: ['https://www.xianggelila.gov.cn/official'],
    source_phrases: ['티베트 불교 최대의 성지 송찬림사'],
    verification_method: 'official_and_supplier_crosscheck',
    evidence_summary: '공급사 원문과 윈난성 공식 자료에서 장소의 명칭과 지역을 교차 확인했습니다.',
    owner_reviewed: true,
    ...overrides,
  };
}

describe('PUT /api/attractions owner-reviewed CSV safety contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resweep.mockResolvedValue({ matched: 1 });
    mocks.reenrich.mockResolvedValue({ updated: 1 });
    setAttractionDbRows();
  });

  it.each([
    ['POST', POST],
    ['PATCH', PATCH],
    ['PUT', PUT],
    ['DELETE', DELETE],
  ] as const)('rejects unauthenticated %s before parsing or DB access', async (method, handler) => {
    const response = await handler(new NextRequest('http://localhost/api/attractions', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify({
        items: [approvedItem()],
        ownerReviewed: true,
        reviewSource: 'admin_csv_owner_confirmed',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('keeps an authenticated direct manual creation internal-only', async () => {
    mocks.insert.mockImplementation((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { id: 'manual-new', ...payload },
          error: null,
        })),
      })),
    }));
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'attractions') throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn(() => ({
          ilike: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
        insert: mocks.insert,
      };
    });

    const response = await POST(new NextRequest('http://localhost/api/attractions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ys-dev-admin=1',
      },
      body: JSON.stringify({
        source_level: 'manual',
        name: '사장님 직접 등록 후보',
        short_desc: '직접 검수한 후보',
        country: '중국',
        region: '쿤밍',
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: '사장님 직접 등록 후보',
      is_manual_override: true,
      customer_publishable: false,
      auto_created: false,
      verification_status: 'manual',
      review_required_reason: 'owner_identity_reviewed_customer_media_pending',
    }));
    expect(mocks.resweep).toHaveBeenCalledWith(['manual-new']);
  });

  it('rejects an upload without the explicit owner confirmation before any DB access', async () => {
    const response = await PUT(request({
      items: [approvedItem()],
      ownerReviewed: false,
      reviewSource: 'admin_csv_owner_confirmed',
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('ATTRACTION_CSV_OWNER_REVIEW_REQUIRED');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects the entire file when one row is not owner-reviewed before DB access', async () => {
    const response = await PUT(request({
      items: [
        approvedItem(),
        approvedItem({ name: '석림', owner_reviewed: false }),
      ],
      ownerReviewed: true,
      reviewSource: 'admin_csv_owner_confirmed',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('ATTRACTION_CSV_HAS_UNREVIEWED_ROWS');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects a new master without complete identity evidence before any write', async () => {
    const response = await PUT(request({
      items: [approvedItem({ official_source_url: '' })],
      ownerReviewed: true,
      reviewSource: 'admin_csv_owner_confirmed',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('ATTRACTION_CSV_NEW_MASTER_EVIDENCE_REQUIRED');
    expect(body.errors).toEqual([
      expect.objectContaining({
        name: '송찬림사',
        missing: ['official_source_url'],
      }),
    ]);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.resweep).not.toHaveBeenCalled();
    expect(mocks.reenrich).not.toHaveBeenCalled();
  });

  it('rejects a new master when source phrases, method, or evidence summary are missing', async () => {
    const response = await PUT(request({
      items: [approvedItem({
        source_phrases: [],
        verification_method: '',
        evidence_summary: '',
      })],
      ownerReviewed: true,
      reviewSource: 'admin_csv_owner_confirmed',
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('ATTRACTION_CSV_NEW_MASTER_EVIDENCE_REQUIRED');
    expect(body.errors).toEqual([
      expect.objectContaining({
        name: '송찬림사',
        missing: ['source_phrases', 'verification_method', 'evidence_summary'],
      }),
    ]);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('creates an approved new master as internal-only and stores owner evidence', async () => {
    const response = await PUT(request({
      items: [approvedItem()],
      ownerReviewed: true,
      reviewSource: 'admin_csv_owner_confirmed',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      upserted: 1,
      newInternalMasters: 1,
      preservedCustomerPublishable: 0,
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const [rows] = mocks.upsert.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows[0]).toMatchObject({
      name: '송찬림사',
      customer_publishable: false,
      verification_status: 'manual',
      auto_created: false,
      is_manual_override: true,
      review_required_reason: 'owner_identity_reviewed_customer_media_pending',
    });
    expect(rows[0].aliases).toEqual(['쑹찬린사']);
    expect(rows[0].source_ids).toMatchObject({
      owner_csv_review: {
        review_source: 'admin_csv_owner_confirmed',
        source_phrases: ['티베트 불교 최대의 성지 송찬림사'],
        verification_method: 'official_and_supplier_crosscheck',
      },
    });
    expect(rows[0].verification_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: 'https://www.visityunnanchina.com/',
        kind: 'official_url',
        review_channel: 'admin_csv_owner_confirmed',
      }),
      expect.objectContaining({
        url: 'https://www.xianggelila.gov.cn/official',
        kind: 'supporting_url',
      }),
    ]));
    expect(mocks.resweep).toHaveBeenCalledWith(['attr-new']);
    expect(mocks.reenrich).toHaveBeenCalledWith(['attr-new'], { maxPackages: 50 });
  });

  it('preserves an existing public master instead of republishing or demoting it', async () => {
    setAttractionDbRows({
      existing: [{
        id: 'attr-existing',
        name: '송찬림사',
        aliases: ['Songzanlin Monastery'],
        customer_publishable: true,
        verification_status: 'published',
        auto_created: false,
        source_ids: { legacy: 'source-1' },
        verification_sources: [],
        review_required_reason: null,
      }],
      saved: [{ id: 'attr-existing', name: '송찬림사' }],
    });

    const response = await PUT(request({
      items: [approvedItem()],
      ownerReviewed: true,
      reviewSource: 'admin_csv_owner_confirmed',
    }));
    const body = await response.json();
    const [rows] = mocks.upsert.mock.calls[0] as [Array<Record<string, unknown>>];

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      newInternalMasters: 0,
      preservedCustomerPublishable: 1,
    });
    expect(rows[0]).toMatchObject({
      customer_publishable: true,
      verification_status: 'published',
      review_required_reason: null,
    });
    expect(rows[0].aliases).toEqual(['Songzanlin Monastery', '쑹찬린사']);
  });
});
