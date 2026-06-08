export type AdOsCredentialPlatform = 'naver' | 'google' | 'meta';

export type SecretRequirement = {
  key: string;
  label: string;
  required: boolean;
};

export type AdOsCredentialReadiness = {
  platform: AdOsCredentialPlatform;
  status: 'ready' | 'partial' | 'missing';
  required_total: number;
  required_ready: number;
  missing_required: string[];
  optional_missing: string[];
  live_flags_enabled: string[];
  live_write_safe: boolean;
  next_action: string;
};

type HasSecret = (key: string) => boolean;

const REQUIREMENTS: Record<AdOsCredentialPlatform, SecretRequirement[]> = {
  naver: [
    { key: 'NAVER_ADS_API_KEY', label: 'Naver Ads API key', required: true },
    { key: 'NAVER_ADS_SECRET_KEY', label: 'Naver Ads secret key', required: true },
    { key: 'NAVER_ADS_CUSTOMER_ID', label: 'Naver Ads customer ID', required: true },
  ],
  google: [
    { key: 'GOOGLE_ADS_DEVELOPER_TOKEN', label: 'Google Ads developer token', required: true },
    { key: 'GOOGLE_ADS_CUSTOMER_ID', label: 'Google Ads customer ID', required: true },
    { key: 'GOOGLE_ADS_CLIENT_ID', label: 'Google OAuth client ID', required: true },
    { key: 'GOOGLE_ADS_CLIENT_SECRET', label: 'Google OAuth client secret', required: true },
    { key: 'GOOGLE_ADS_REFRESH_TOKEN', label: 'Google OAuth refresh token', required: true },
    { key: 'GOOGLE_ADS_CONVERSION_ACTION_ID', label: 'Google conversion action ID', required: false },
  ],
  meta: [
    { key: 'META_AD_ACCOUNT_ID', label: 'Meta ad account ID', required: true },
    { key: 'META_ACCESS_TOKEN', label: 'Meta access token', required: true },
    { key: 'META_PIXEL_ID', label: 'Meta pixel ID', required: false },
    { key: 'META_CAPI_ACCESS_TOKEN', label: 'Meta CAPI access token', required: false },
    { key: 'META_PAGE_ID', label: 'Meta page ID', required: false },
  ],
};

const LIVE_FLAGS: Record<AdOsCredentialPlatform, string[]> = {
  naver: ['AD_OS_NAVER_LIMITED_WRITE_ENABLED'],
  google: ['AD_OS_GOOGLE_CONVERSION_UPLOAD_ENABLED', 'AD_OS_CONVERSION_UPLOAD_ENABLED'],
  meta: ['AD_OS_META_CAPI_UPLOAD_ENABLED', 'AD_OS_CONVERSION_UPLOAD_ENABLED'],
};

function flagEnabled(value: string | null | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function buildAdOsCredentialReadiness(input: {
  hasSecret: HasSecret;
  getFlag?: (key: string) => string | null | undefined;
}): AdOsCredentialReadiness[] {
  return (Object.keys(REQUIREMENTS) as AdOsCredentialPlatform[]).map((platform) => {
    const requirements = REQUIREMENTS[platform];
    const required = requirements.filter((item) => item.required);
    const requiredReady = required.filter((item) => input.hasSecret(item.key)).length;
    const missingRequired = required.filter((item) => !input.hasSecret(item.key)).map((item) => item.key);
    const optionalMissing = requirements
      .filter((item) => !item.required && !input.hasSecret(item.key))
      .map((item) => item.key);
    const liveFlagsEnabled = LIVE_FLAGS[platform].filter((key) => flagEnabled(input.getFlag?.(key)));
    const liveWriteSafe = liveFlagsEnabled.length === 0;
    const status = requiredReady === required.length ? 'ready' : requiredReady > 0 ? 'partial' : 'missing';

    return {
      platform,
      status,
      required_total: required.length,
      required_ready: requiredReady,
      missing_required: missingRequired,
      optional_missing: optionalMissing,
      live_flags_enabled: liveFlagsEnabled,
      live_write_safe: liveWriteSafe,
      next_action: missingRequired.length > 0
        ? `Configure ${missingRequired[0]} in Vercel environment variables.`
        : liveWriteSafe
          ? 'Credentials are ready for draft, dry-run, and approval-gated flows.'
          : 'Turn live-write env flags off unless an approved limited pilot is in progress.',
    };
  });
}

export function summarizeAdOsCredentialReadiness(readiness: AdOsCredentialReadiness[]) {
  return {
    platforms: readiness.length,
    ready: readiness.filter((item) => item.status === 'ready').length,
    partial: readiness.filter((item) => item.status === 'partial').length,
    missing: readiness.filter((item) => item.status === 'missing').length,
    live_write_safe: readiness.every((item) => item.live_write_safe),
    live_flags_enabled: readiness.flatMap((item) => item.live_flags_enabled),
    missing_required: readiness.reduce<Record<string, string[]>>((acc, item) => {
      acc[item.platform] = item.missing_required;
      return acc;
    }, {}),
  };
}
