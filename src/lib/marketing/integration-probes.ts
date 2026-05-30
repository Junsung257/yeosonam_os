import { google } from 'googleapis';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getSecret, type SecretKey } from '@/lib/secret-registry';

export type ProbeStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface IntegrationProbeResult {
  key: string;
  label: string;
  status: ProbeStatus;
  message: string;
  detail?: Record<string, unknown>;
}

const META_GRAPH_BASE = 'https://graph.facebook.com/v18.0';

function hasAll(keys: SecretKey[]) {
  return keys.every((key) => !!getSecret(key));
}

function skipped(key: string, label: string, missing: SecretKey[]): IntegrationProbeResult {
  return {
    key,
    label,
    status: 'skipped',
    message: `Missing settings: ${missing.filter((name) => !getSecret(name)).join(', ')}`,
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timeout);
  }
}

function safeErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function metaError(json: unknown, status: number) {
  const error = (json as { error?: { code?: number; message?: string; type?: string } } | null)?.error;
  if (!error) return `HTTP ${status}`;
  return `HTTP ${status} code=${error.code ?? 'unknown'} type=${error.type ?? 'unknown'}: ${error.message ?? 'Meta error'}`;
}

async function probeSupabase(): Promise<IntegrationProbeResult> {
  if (!isSupabaseConfigured) {
    return { key: 'supabase.admin', label: 'Supabase admin', status: 'fail', message: 'Supabase is not configured.' };
  }

  try {
    const { count, error } = await supabaseAdmin
      .from('content_creatives')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    return {
      key: 'supabase.admin',
      label: 'Supabase admin',
      status: 'ok',
      message: `Connected. content_creatives rows: ${count ?? 0}.`,
    };
  } catch (err) {
    return { key: 'supabase.admin', label: 'Supabase admin', status: 'fail', message: safeErrorMessage(err) };
  }
}

async function probeMetaMe(): Promise<IntegrationProbeResult> {
  const token = getSecret('META_ACCESS_TOKEN');
  if (!token) return skipped('meta.me', 'Meta token', ['META_ACCESS_TOKEN']);

  try {
    const url = `${META_GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(token)}`;
    const res = await fetchJson(url);
    if (!res.ok) {
      return { key: 'meta.me', label: 'Meta token', status: 'fail', message: metaError(res.json, res.status) };
    }
    const data = res.json as { id?: string; name?: string };
    return {
      key: 'meta.me',
      label: 'Meta token',
      status: 'ok',
      message: `Token is valid for ${data.name ?? 'Meta user/app'}.`,
      detail: { id_present: Boolean(data.id) },
    };
  } catch (err) {
    return { key: 'meta.me', label: 'Meta token', status: 'fail', message: safeErrorMessage(err) };
  }
}

async function probeMetaAdAccount(): Promise<IntegrationProbeResult> {
  const required: SecretKey[] = ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'];
  if (!hasAll(required)) return skipped('meta.ad_account', 'Meta ad account', required);

  try {
    const token = getSecret('META_ACCESS_TOKEN')!;
    const adAccountId = getSecret('META_AD_ACCOUNT_ID')!;
    const url = `${META_GRAPH_BASE}/${adAccountId}?fields=id,name,account_status,currency,timezone_name&access_token=${encodeURIComponent(token)}`;
    const res = await fetchJson(url);
    if (!res.ok) {
      return { key: 'meta.ad_account', label: 'Meta ad account', status: 'fail', message: metaError(res.json, res.status) };
    }
    const data = res.json as { name?: string; account_status?: number; currency?: string; timezone_name?: string };
    return {
      key: 'meta.ad_account',
      label: 'Meta ad account',
      status: data.account_status === 1 ? 'ok' : 'warn',
      message: `Account reachable${data.name ? `: ${data.name}` : ''}.`,
      detail: {
        account_status: data.account_status,
        currency: data.currency,
        timezone_name: data.timezone_name,
      },
    };
  } catch (err) {
    return { key: 'meta.ad_account', label: 'Meta ad account', status: 'fail', message: safeErrorMessage(err) };
  }
}

async function probeMetaInstagram(): Promise<IntegrationProbeResult> {
  const required: SecretKey[] = ['META_ACCESS_TOKEN', 'META_IG_USER_ID'];
  if (!hasAll(required)) return skipped('meta.instagram', 'Instagram business user', required);

  try {
    const token = getSecret('META_ACCESS_TOKEN')!;
    const igUserId = getSecret('META_IG_USER_ID')!;
    const url = `${META_GRAPH_BASE}/${igUserId}?fields=id,username,followers_count,media_count&access_token=${encodeURIComponent(token)}`;
    const res = await fetchJson(url);
    if (!res.ok) {
      return { key: 'meta.instagram', label: 'Instagram business user', status: 'fail', message: metaError(res.json, res.status) };
    }
    const data = res.json as { username?: string; followers_count?: number; media_count?: number };
    return {
      key: 'meta.instagram',
      label: 'Instagram business user',
      status: 'ok',
      message: `Instagram reachable${data.username ? `: @${data.username}` : ''}.`,
      detail: { followers_count: data.followers_count, media_count: data.media_count },
    };
  } catch (err) {
    return { key: 'meta.instagram', label: 'Instagram business user', status: 'fail', message: safeErrorMessage(err) };
  }
}

async function probeGoogleServiceAccount(): Promise<IntegrationProbeResult> {
  const raw = getSecret('GSC_SERVICE_ACCOUNT_JSON') || getSecret('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) {
    return skipped('google.service_account', 'Google service account', ['GSC_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_JSON']);
  }

  try {
    const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!credentials.client_email || !credentials.private_key) {
      return {
        key: 'google.service_account',
        label: 'Google service account',
        status: 'fail',
        message: 'Service account JSON is missing client_email or private_key.',
      };
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const client = await auth.getClient();
    await client.getAccessToken();

    const siteUrl = getSecret('GSC_SITE_URL');
    if (!siteUrl) {
      return {
        key: 'google.service_account',
        label: 'Google service account',
        status: 'warn',
        message: 'Service account token works, but GSC_SITE_URL is missing.',
        detail: { client_email_present: true },
      };
    }

    const searchconsole = google.searchconsole({ version: 'v1', auth });
    await searchconsole.sites.get({ siteUrl });
    return {
      key: 'google.service_account',
      label: 'Google Search Console',
      status: 'ok',
      message: `GSC site is reachable: ${siteUrl}.`,
    };
  } catch (err) {
    return { key: 'google.service_account', label: 'Google service account', status: 'fail', message: safeErrorMessage(err) };
  }
}

async function probePexels(): Promise<IntegrationProbeResult> {
  const token = getSecret('PEXELS_API_KEY');
  if (!token) return skipped('pexels.assets', 'Pexels assets', ['PEXELS_API_KEY']);

  try {
    const res = await fetchJson('https://api.pexels.com/v1/search?query=travel&per_page=1', {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      return { key: 'pexels.assets', label: 'Pexels assets', status: 'fail', message: `HTTP ${res.status}` };
    }
    const total = (res.json as { total_results?: number } | null)?.total_results;
    return {
      key: 'pexels.assets',
      label: 'Pexels assets',
      status: 'ok',
      message: 'Pexels API is reachable.',
      detail: { total_results_present: typeof total === 'number' },
    };
  } catch (err) {
    return { key: 'pexels.assets', label: 'Pexels assets', status: 'fail', message: safeErrorMessage(err) };
  }
}

function configOnlyProbe(key: string, label: string, required: SecretKey[]): IntegrationProbeResult {
  const missing = required.filter((name) => !getSecret(name));
  return missing.length
    ? skipped(key, label, missing)
    : { key, label, status: 'warn', message: 'Configured, but no read-only probe is implemented yet.' };
}

export async function runMarketingIntegrationProbes(): Promise<IntegrationProbeResult[]> {
  return Promise.all([
    probeSupabase(),
    probeMetaMe(),
    probeMetaAdAccount(),
    probeMetaInstagram(),
    probeGoogleServiceAccount(),
    probePexels(),
    configOnlyProbe('threads.publish', 'Threads publish credentials', ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID']),
    configOnlyProbe('naver.ads', 'Naver Search Ads credentials', ['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID']),
    configOnlyProbe('google.ads', 'Google Ads credentials', ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID']),
    configOnlyProbe('naver.oauth', 'Naver OAuth credentials', ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET']),
  ]);
}
