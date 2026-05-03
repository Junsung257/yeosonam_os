/**
 * Vercel 어드민 딥링크 기본값.
 * Cursor Vercel MCP `list_teams` / `get_project` + `.vercel/project.json` 기준 (여소남 OS).
 *
 * 다른 팀/프로젝트로 포크 시: Vercel 환경 변수
 *   VERCEL_OPS_TEAM_SLUG, VERCEL_OPS_PROJECT_SLUG
 * 또는 OPS_VERCEL_DASHBOARD_URL 로 Cron 화면만 덮어쓰기.
 */

export const VERCEL_OPS_DEFAULT_TEAM_SLUG = 'zzbaa0317-4596s-projects';
export const VERCEL_OPS_DEFAULT_PROJECT_SLUG = 'os';

export function getVercelOpsProjectBaseUrl(): string {
  const team = process.env.VERCEL_OPS_TEAM_SLUG?.trim() || VERCEL_OPS_DEFAULT_TEAM_SLUG;
  const project = process.env.VERCEL_OPS_PROJECT_SLUG?.trim() || VERCEL_OPS_DEFAULT_PROJECT_SLUG;
  return `https://vercel.com/${encodeURIComponent(team)}/${encodeURIComponent(project)}`;
}
