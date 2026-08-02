import { describe, expect, it, vi } from 'vitest';

import { loadApprovedDestinationMedia } from './approved-destination-media';

function supabaseReturning(input: { data?: unknown; error?: { message: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: input.data ?? null,
    error: input.error ?? null,
  });
  const eqApproved = vi.fn(() => ({ maybeSingle }));
  const eqDestination = vi.fn(() => ({ eq: eqApproved }));
  const select = vi.fn(() => ({ eq: eqDestination }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as never,
    calls: { from, select, eqDestination, eqApproved, maybeSingle },
  };
}

describe('loadApprovedDestinationMedia', () => {
  it('returns only an exact, owner-approved, attributed image', async () => {
    const db = supabaseReturning({
      data: {
        destination: '클락',
        hero_image_url: 'https://cdn.example.com/clark.jpg',
        hero_image_pexels_id: 123,
        hero_photographer: 'Photo Owner',
        hero_image_provider: 'pexels',
        hero_image_source_page_url: 'https://www.pexels.com/photo/123/',
        hero_image_source_file_title: null,
        hero_image_license: null,
        hero_image_license_url: null,
        hero_image_alt: '클락 전경',
        photo_approved_at: '2026-07-30T00:00:00.000Z',
        photo_approval_source: 'owner_reviewed',
      },
    });

    const result = await loadApprovedDestinationMedia({
      supabase: db.client,
      isSupabaseConfigured: true,
      destination: ' 클락 ',
    });

    expect(result).toEqual({
      status: 'ready',
      media: expect.objectContaining({
        destination: '클락',
        url: 'https://cdn.example.com/clark.jpg',
        photographer: 'Photo Owner',
        provider: 'pexels',
        approval_source: 'owner_approved_destination_metadata',
      }),
    });
    expect(db.calls.eqDestination).toHaveBeenCalledWith('destination', '클락');
    expect(db.calls.eqApproved).toHaveBeenCalledWith('photo_approved', true);
  });

  it('fails closed when attribution or approval evidence is incomplete', async () => {
    const db = supabaseReturning({
      data: {
        destination: '클락',
        hero_image_url: 'https://cdn.example.com/clark.jpg',
        hero_photographer: '',
        hero_image_provider: 'pexels',
        hero_image_source_page_url: 'https://www.pexels.com/photo/123/',
        photo_approved_at: null,
      },
    });

    const result = await loadApprovedDestinationMedia({
      supabase: db.client,
      isSupabaseConfigured: true,
      destination: '클락',
    });

    expect(result.status).toBe('invalid');
  });

  it('does not guess aliases or fall back to a search result', async () => {
    const db = supabaseReturning({ data: null });
    const result = await loadApprovedDestinationMedia({
      supabase: db.client,
      isSupabaseConfigured: true,
      destination: '삿포로/니세코',
    });

    expect(result).toEqual({ status: 'not_found', media: null });
    expect(db.calls.maybeSingle).toHaveBeenCalledTimes(1);
  });
});
