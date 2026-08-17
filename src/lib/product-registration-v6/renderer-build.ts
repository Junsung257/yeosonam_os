export function currentProductRegistrationRendererBuildId(): string {
  const configured = [
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.NEXT_PUBLIC_BUILD_ID,
  ].find(value => typeof value === 'string' && value.trim().length > 0);
  return configured?.trim() ?? 'local-v6-renderer';
}
