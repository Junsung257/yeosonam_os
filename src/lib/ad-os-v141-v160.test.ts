import { describe, expect, it } from 'vitest';
import { buildGoogleConversionExportPackets, buildMetaConversionExportPackets } from './ad-os-v31-v40';
import { sanitizeAdOsConversionPayload } from './ad-os-v141-v160';

describe('Ad OS V141-V160 conversion PII sanitizer', () => {
  it('removes raw PII from conversion raw payload and keeps first-party hashes', () => {
    const sanitized = sanitizeAdOsConversionPayload({
      event_type: 'booking',
      email: 'Traveler@Example.com',
      phone: '010-1234-5678',
      customer_name: 'Kim Traveler',
      passport_no: 'M12345678',
      nested: {
        customer_email: 'nested@example.com',
        safe_value: 'kept',
      },
      booking_id: 'booking-1',
    });

    expect(JSON.stringify(sanitized.rawPayload)).not.toContain('Traveler@Example.com');
    expect(JSON.stringify(sanitized.rawPayload)).not.toContain('010-1234-5678');
    expect(JSON.stringify(sanitized.rawPayload)).not.toContain('Kim Traveler');
    expect(JSON.stringify(sanitized.rawPayload)).not.toContain('M12345678');
    expect(sanitized.rawPayload.nested).toMatchObject({ safe_value: 'kept' });
    expect(sanitized.rawPayload.first_party_hashes).toMatchObject({
      email_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      phone_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(sanitized.qualityFlags).toMatchObject({
      raw_pii_removed: true,
      first_party_hashes_present: true,
      raw_pii_storage_blocked: true,
    });
  });

  it('lets Google conversion export use hashed identifiers without raw email or phone', () => {
    const sanitized = sanitizeAdOsConversionPayload({
      email: 'buyer@example.com',
      marketing_consent: 'granted',
    });
    const [packet] = buildGoogleConversionExportPackets([
      {
        id: 'event-1',
        event_type: 'booking',
        event_time: '2026-06-03T00:00:00.000Z',
        quarantine_status: 'clean',
        raw_payload: sanitized.rawPayload,
        revenue_krw: 500000,
        margin_krw: 50000,
      },
    ]);

    expect(packet.ready_for_upload).toBe(true);
    expect(packet.identifiers.email_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(packet)).not.toContain('buyer@example.com');
  });

  it('lets Meta conversion export use hashed phone without raw phone storage', () => {
    const sanitized = sanitizeAdOsConversionPayload({
      phone: '01099998888',
      marketing_consent: 'granted',
    });
    const [packet] = buildMetaConversionExportPackets([
      {
        id: 'event-2',
        event_type: 'lead',
        event_time: '2026-06-03T00:00:00.000Z',
        quarantine_status: 'clean',
        raw_payload: sanitized.rawPayload,
      },
    ]);

    expect(packet.ready_for_upload).toBe(true);
    expect(packet.identifiers.phone_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(packet)).not.toContain('01099998888');
  });
});
