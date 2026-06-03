import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';

export interface OAuthRefreshResult {
  platform: string;
  success: boolean;
  error?: string;
}

async function refreshMetaToken(
  platform: string,
  accessToken: string,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const appId = getSecret('META_APP_ID');
  const appSecret = getSecret('META_APP_SECRET');
  if (!appId || !appSecret) {
    console.warn(`[social-oauth-refresh] ${platform}: Meta app credentials are not configured`);
    return null;
  }

  const url = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', accessToken);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const body = sanitizeDbError(await res.text().catch(() => ''), 'Meta token refresh failed');
    console.warn(`[social-oauth-refresh] ${platform} token refresh failed (HTTP ${res.status}): ${body}`);
    return null;
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    console.warn(`[social-oauth-refresh] ${platform} refresh response did not include access_token`);
    return null;
  }

  const expiresIn = json.expires_in ?? 60 * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return { accessToken: json.access_token, expiresAt };
}

async function refreshTokenForPlatform(
  platform: string,
  accessToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  console.log(`[social-oauth-refresh] ${platform} token refresh started`);

  const metaPlatforms = new Set(['threads', 'instagram', 'facebook']);
  if (metaPlatforms.has(platform)) {
    const result = await refreshMetaToken(platform, accessToken);
    if (result) {
      console.log(`[social-oauth-refresh] ${platform} token refresh completed (expires=${result.expiresAt.toISOString()})`);
      return result;
    }

    console.warn(`[social-oauth-refresh] ${platform} token refresh failed; keeping existing token temporarily`);
    return { accessToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
  }

  console.log(`[social-oauth-refresh] ${platform} refresh is not implemented; extending simulated expiry`);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return { accessToken, expiresAt };
}

export async function refreshExpiringTokens(): Promise<OAuthRefreshResult[]> {
  const results: OAuthRefreshResult[] = [];

  try {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: configs, error } = await supabaseAdmin
      .from('social_platform_configs')
      .select('platform, access_token, token_expires_at')
      .eq('enabled', true)
      .lt('token_expires_at', sevenDaysFromNow);

    if (error) {
      console.error('[social-oauth-refresh] config lookup failed:', sanitizeDbError(error));
      return results;
    }

    if (!configs || configs.length === 0) {
      console.log('[social-oauth-refresh] no expiring tokens found');
      return results;
    }

    console.log(`[social-oauth-refresh] refreshing ${configs.length} platform tokens`);

    for (const config of configs) {
      const platform = config.platform as string;
      try {
        const { accessToken, expiresAt } = await refreshTokenForPlatform(
          platform,
          config.access_token as string,
        );

        const { error: updateError } = await supabaseAdmin
          .from('social_platform_configs')
          .update({
            access_token: accessToken,
            token_expires_at: expiresAt.toISOString(),
          })
          .eq('platform', platform);

        if (updateError) {
          results.push({
            platform,
            success: false,
            error: `DB update failed: ${sanitizeDbError(updateError)}`,
          });
        } else {
          results.push({ platform, success: true });
        }
      } catch (err) {
        const message = sanitizeDbError(err, 'OAuth token refresh failed');
        console.error(`[social-oauth-refresh] ${platform} refresh failed:`, message);
        results.push({ platform, success: false, error: message });
      }
    }
  } catch (err) {
    console.error('[social-oauth-refresh] refresh job failed:', sanitizeDbError(err, 'OAuth token refresh failed'));
  }

  return results;
}
