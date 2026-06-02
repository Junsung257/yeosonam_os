import { createHash } from 'crypto';

type JsonRecord = Record<string, unknown>;

const RAW_PII_KEY_PATTERNS = [
  /(^|_)email($|_)/i,
  /(^|_)(phone|tel|mobile|contact_phone)($|_)/i,
  /(^|_)(name|customer_name|passport_name)($|_)/i,
  /passport/i,
  /resident/i,
  /rrn/i,
];

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizeEmail(value: unknown): string | null {
  const text = String(value || '').trim().toLowerCase();
  return text.includes('@') ? text : null;
}

function normalizePhone(value: unknown): string | null {
  const text = String(value || '').replace(/[^\d+]/g, '');
  return text.length >= 8 ? text : null;
}

function isRawPiiKey(key: string): boolean {
  return RAW_PII_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function collectHash(key: string, value: unknown, hashes: JsonRecord) {
  const email = /email/i.test(key) ? normalizeEmail(value) : null;
  if (email) hashes.email_sha256 = sha256(email);

  const phone = /(phone|tel|mobile)/i.test(key) ? normalizePhone(value) : null;
  if (phone) hashes.phone_sha256 = sha256(phone);
}

function sanitizeRecord(input: JsonRecord, redactedKeys: string[], hashes: JsonRecord, prefix = ''): JsonRecord {
  const output: JsonRecord = {};

  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRawPiiKey(key)) {
      redactedKeys.push(path);
      collectHash(key, value, hashes);
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = sanitizeRecord(value as JsonRecord, redactedKeys, hashes, path);
      continue;
    }

    if (Array.isArray(value)) {
      output[key] = value.map((item, index) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeRecord(item as JsonRecord, redactedKeys, hashes, `${path}[${index}]`)
          : item,
      );
      continue;
    }

    output[key] = value;
  }

  return output;
}

export function sanitizeAdOsConversionPayload(input: JsonRecord): {
  rawPayload: JsonRecord;
  redactedKeys: string[];
  firstPartyHashes: JsonRecord;
  qualityFlags: JsonRecord;
} {
  const redactedKeys: string[] = [];
  const firstPartyHashes: JsonRecord = {};
  const rawPayload = sanitizeRecord(input, redactedKeys, firstPartyHashes);

  if (Object.keys(firstPartyHashes).length > 0) {
    rawPayload.first_party_hashes = firstPartyHashes;
  }
  if (redactedKeys.length > 0) {
    rawPayload.pii_redaction = {
      raw_pii_removed: true,
      redacted_key_count: redactedKeys.length,
    };
  }

  return {
    rawPayload,
    redactedKeys,
    firstPartyHashes,
    qualityFlags: {
      raw_pii_removed: redactedKeys.length > 0,
      raw_pii_redacted_keys: redactedKeys,
      first_party_hashes_present: Object.keys(firstPartyHashes).length > 0,
      raw_pii_storage_blocked: true,
    },
  };
}
