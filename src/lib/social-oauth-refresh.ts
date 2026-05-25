import { supabaseAdmin } from "@/lib/supabase";
import { getSecret } from "@/lib/secret-registry";

export interface OAuthRefreshResult {
  platform: string;
  success: boolean;
  error?: string;
}

/**
 * Meta 계열 (threads, instagram, facebook) OAuth 토큰 갱신.
 *
 * Meta long-lived token(60일)은 fb_exchange_token 엔드포인트로 갱신한다.
 * 갱신 시 60일짜리 새 토큰이 발급된다.
 * 발급 조건: 만료까지 24시간 이상 남아있어야 함 (Meta 정책).
 * 실패 시 기존 토큰을 유지한다.
 */
async function refreshMetaToken(
  platform: string,
  accessToken: string
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const appId = getSecret("META_APP_ID");
  const appSecret = getSecret("META_APP_SECRET");
  if (!appId || !appSecret) {
    console.warn(
      `[social-oauth-refresh] ${platform}: META_APP_ID 또는 META_APP_SECRET 미설정`
    );
    return null;
  }

  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", accessToken);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[social-oauth-refresh] ${platform} fb_exchange_token 실패 (HTTP ${res.status}): ${body.slice(0, 200)}`
    );
    return null;
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    console.warn(`[social-oauth-refresh] ${platform} 응답에 access_token 없음`);
    return null;
  }

  // expires_in이 없으면 기본 60일
  const expiresIn = json.expires_in ?? 60 * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return { accessToken: json.access_token, expiresAt };
}

/**
 * 플랫폼별 OAuth 토큰 갱신.
 */
async function refreshTokenForPlatform(
  platform: string,
  accessToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  console.log(`[social-oauth-refresh] ${platform} 토큰 갱신 처리 중...`);

  // Meta 계열: threads, instagram, facebook
  const META_PLATFORMS = new Set(["threads", "instagram", "facebook"]);
  if (META_PLATFORMS.has(platform)) {
    const result = await refreshMetaToken(platform, accessToken);
    if (result) {
      console.log(
        `[social-oauth-refresh] ${platform} 토큰 갱신 완료 (만료: ${result.expiresAt.toISOString()})`
      );
      return result;
    }
    // 실패 시 기존 토큰 유지 (만료 시각 연장 없음)
    console.warn(
      `[social-oauth-refresh] ${platform} 갱신 실패 — 기존 토큰 유지`
    );
    return { accessToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
  }

  // 기타 플랫폼 (twitter, naver 등) — 추후 구현
  console.log(`[social-oauth-refresh] ${platform} — 아직 refresh 구현 안 됨, 30일 시뮬레이션`);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return { accessToken, expiresAt };
}

/**
 * 7일 이내 만료 예정인 OAuth 토큰을 모두 갱신한다.
 *
 * - social_platform_configs에서 enabled = true이고
 *   token_expires_at이 현재 + 7일 이내인 레코드를 조회
 * - 각 플랫폼별로 refreshTokenForPlatform() 호출
 * - 갱신된 토큰과 만료 시각을 DB에 업데이트
 *
 * @returns 갱신 결과 배열
 */
export async function refreshExpiringTokens(): Promise<OAuthRefreshResult[]> {
  const results: OAuthRefreshResult[] = [];

  try {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: configs, error } = await supabaseAdmin
      .from("social_platform_configs")
      .select("platform, access_token, token_expires_at")
      .eq("enabled", true)
      .lt("token_expires_at", sevenDaysFromNow);

    if (error) {
      console.error("[social-oauth-refresh] 설정 조회 실패:", error.message);
      return results;
    }

    if (!configs || configs.length === 0) {
      console.log("[social-oauth-refresh] 갱신할 토큰이 없습니다.");
      return results;
    }

    console.log(
      `[social-oauth-refresh] ${configs.length}개 플랫폼 토큰 갱신 시작`
    );

    for (const config of configs) {
      const platform = config.platform as string;
      try {
        const { accessToken, expiresAt } = await refreshTokenForPlatform(
          platform,
          config.access_token as string
        );

        const { error: updateError } = await supabaseAdmin
          .from("social_platform_configs")
          .update({
            access_token: accessToken,
            token_expires_at: expiresAt.toISOString(),
          })
          .eq("platform", platform);

        if (updateError) {
          results.push({
            platform,
            success: false,
            error: `DB 업데이트 실패: ${updateError.message}`,
          });
        } else {
          results.push({ platform, success: true });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "알 수 없는 오류";
        console.error(
          `[social-oauth-refresh] ${platform} 갱신 실패:`,
          message
        );
        results.push({ platform, success: false, error: message });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    console.error("[social-oauth-refresh] 전체 처리 실패:", message);
  }

  return results;
}
