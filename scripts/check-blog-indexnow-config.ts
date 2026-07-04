type CheckResult = {
  passed: boolean;
  origin: string;
  indexnow_key_configured: boolean;
  indexnow_key_valid_shape: boolean;
  verification_file_status: number | null;
  verification_body_matches_key: boolean;
  random_txt_status: number | null;
  issues: string[];
};

function readCanonicalOrigin(): string {
  const raw = process.env.BLOG_CANONICAL_ORIGIN
    || process.env.NEXT_PUBLIC_BASE_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || 'https://www.yeosonam.com';
  return raw.replace(/\/+$/, '');
}

async function fetchStatusAndBody(url: string): Promise<{ status: number | null; body: string }> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return {
      status: response.status,
      body: await response.text(),
    };
  } catch {
    return {
      status: null,
      body: '',
    };
  }
}

async function checkIndexNowConfig(): Promise<CheckResult> {
  const origin = readCanonicalOrigin();
  const key = process.env.INDEXNOW_KEY?.trim() ?? '';
  const keyConfigured = key.length > 0;
  const keyValidShape = /^[A-Za-z0-9_-]{8,128}$/.test(key);
  const issues: string[] = [];

  let verificationFileStatus: number | null = null;
  let verificationBodyMatchesKey = false;

  if (!keyConfigured) {
    issues.push('INDEXNOW_KEY_missing');
  } else if (!keyValidShape) {
    issues.push('INDEXNOW_KEY_invalid_shape');
  } else {
    const verification = await fetchStatusAndBody(`${origin}/${encodeURIComponent(key)}.txt`);
    verificationFileStatus = verification.status;
    verificationBodyMatchesKey = verification.body.trim() === key;
    if (verificationFileStatus !== 200) issues.push('indexnow_verification_file_not_200');
    if (!verificationBodyMatchesKey) issues.push('indexnow_verification_body_mismatch');
  }

  const randomPath = `/not-the-indexnow-key-${Date.now().toString(36)}.txt`;
  const randomTxt = await fetchStatusAndBody(`${origin}${randomPath}`);
  if (randomTxt.status !== 404) issues.push('unexpected_random_txt_route_match');

  return {
    passed: issues.length === 0,
    origin,
    indexnow_key_configured: keyConfigured,
    indexnow_key_valid_shape: keyValidShape,
    verification_file_status: verificationFileStatus,
    verification_body_matches_key: verificationBodyMatchesKey,
    random_txt_status: randomTxt.status,
    issues,
  };
}

async function main() {
  const json = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');
  const result = await checkIndexNowConfig();

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.passed
      ? 'IndexNow configuration check passed.'
      : `IndexNow configuration check failed: ${result.issues.join(', ')}`);
  }

  if (strict && !result.passed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
