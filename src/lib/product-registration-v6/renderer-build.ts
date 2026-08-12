export function currentProductRegistrationRendererBuildId(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.NEXT_PUBLIC_BUILD_ID
    ?? 'local-v6-renderer';
}
