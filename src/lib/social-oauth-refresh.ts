import { supabaseAdmin } from "@/lib/supabase";

export interface OAuthRefreshResult {
  platform: string;
  success: boolean;
  error?: string;
}

/**
 * 소셜 플랫폼 OAuth 토큰 갱신 (stub)
 *
 * 실제 구현에서는 각 플랫폼의 refresh_token 엔드포인트를 호출해야 한다.
 * 현재는 로그만 남기고 30일 연장된 토큰을 시뮬레이션한다.
 */
async function refreshTokenForPlatform(
  platform: string,
  _accessToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  // 실제 구현: platform별 OAuth refresh endpoint 호출
  // 예: Instagram Graph API → POST /oauth/access_token
  console.log(`[social-oauth-refresh] ${platform} 토큰 갱신 처리 중...`);

  // stub: 항상 성공, 30일 연장
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const simulatedToken = `refreshed_${platform}_${Date.now()}`;

  console.log(
    `[social-oauth-refresh] ${platform} 토큰 갱신 완료 (만료: ${expiresAt.toISOString()})`
  );

  return { accessToken: simulatedToken, expiresAt };
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
