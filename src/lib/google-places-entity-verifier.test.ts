import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyGooglePlacesEntityName } from './google-places-entity-verifier';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyGooglePlacesEntityName', () => {
  it('scores an exact attraction match with region and type support', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_PLACES_ENABLED', 'true');
    vi.stubEnv('GOOGLE_PLACES_DAILY_LIMIT', '10');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      places: [{
        id: 'place-1',
        displayName: { text: 'Tokyo Tower' },
        formattedAddress: '4 Chome-2-8 Shibakoen, Minato City, Tokyo, Japan',
        types: ['tourist_attraction', 'point_of_interest'],
        googleMapsUri: 'https://maps.google.com/?cid=1',
      }],
    }), { status: 200 }));

    const result = await verifyGooglePlacesEntityName({
      label: 'Tokyo Tower',
      region: 'Tokyo',
      country: 'JP',
      category: 'attraction',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.configured).toBe(true);
    expect(result.canonicalName).toBe('Tokyo Tower');
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.hasStrongPlaceIdentity).toBe(true);
    expect(result.sources[0]).toEqual(expect.objectContaining({
      source: 'google_places',
      id: 'place-1',
      name: 'Tokyo Tower',
    }));
  });

  it('penalizes a country conflict instead of treating the place as strong identity', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_PLACES_ENABLED', 'true');
    vi.stubEnv('GOOGLE_PLACES_DAILY_LIMIT', '10');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      places: [{
        id: 'place-us',
        displayName: { text: 'Tokyo Tower' },
        formattedAddress: 'Little Tokyo, Los Angeles, United States',
        types: ['tourist_attraction', 'point_of_interest'],
        googleMapsUri: 'https://maps.google.com/?cid=2',
      }],
    }), { status: 200 }));

    const result = await verifyGooglePlacesEntityName({
      label: 'Tokyo Tower',
      region: 'Tokyo',
      country: 'JP',
      category: 'attraction',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.regionConflict).toBe(true);
    expect(result.hasStrongPlaceIdentity).toBe(false);
    expect(result.score).toBeLessThan(0.78);
  });

  it('skips cleanly when the server key is missing', async () => {
    const result = await verifyGooglePlacesEntityName({
      label: 'Tokyo Tower',
      region: 'Tokyo',
      country: 'JP',
      category: 'attraction',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(result.configured).toBe(false);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      source: 'google_places',
      status: 'skipped',
    }));
  });

  it('does not call Google when the key exists but the feature flag is not enabled', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    const fetchImpl = vi.fn();

    const result = await verifyGooglePlacesEntityName({
      label: 'Tokyo Tower',
      region: 'Tokyo',
      country: 'JP',
      category: 'attraction',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.configured).toBe(true);
    expect(result.enabled).toBe(false);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      source: 'google_places',
      status: 'skipped',
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call Google when the daily limit is zero', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_PLACES_ENABLED', 'true');
    vi.stubEnv('GOOGLE_PLACES_DAILY_LIMIT', '0');
    const fetchImpl = vi.fn();

    const result = await verifyGooglePlacesEntityName({
      label: 'Tokyo Tower',
      region: 'Tokyo',
      country: 'JP',
      category: 'attraction',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.attempts[0]).toEqual(expect.objectContaining({
      source: 'google_places',
      status: 'skipped',
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps Google queries per candidate when enabled', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_PLACES_ENABLED', 'true');
    vi.stubEnv('GOOGLE_PLACES_DAILY_LIMIT', '10');
    vi.stubEnv('GOOGLE_PLACES_MAX_QUERIES_PER_CANDIDATE', '1');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ places: [] }), { status: 200 }));

    const result = await verifyGooglePlacesEntityName({
      label: 'Tokyo Tower',
      aliases: ['Tokyo Tower Observatory', '東京タワー'],
      region: 'Tokyo',
      destination: 'Minato',
      country: 'JP',
      category: 'attraction',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      source: 'google_places',
      status: 'empty',
    }));
  });
});
