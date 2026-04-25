/**
 * SocialProvider 레지스트리.
 *
 * 새 플랫폼 추가 시 이 파일만 수정하면 publish-scheduled, sync-engagement 등이
 * 자동으로 인식. 10년 관점 유지보수 핵심.
 */
import { InstagramProvider } from './instagram-provider';
import { ThreadsProvider } from './threads-provider';
import type { SocialProvider, SocialPlatform } from './types';

const providers: Record<string, SocialProvider> = {
  instagram: new InstagramProvider(),
  threads: new ThreadsProvider(),
  // 추후: tiktok: new TikTokProvider(), youtube_shorts: new YouTubeShortsProvider(), ...
};

export function getProvider(platform: SocialPlatform | string): SocialProvider | null {
  return providers[platform] ?? null;
}

export function listProviders(): SocialProvider[] {
  return Object.values(providers);
}

export function listConfiguredProviders(): SocialProvider[] {
  return Object.values(providers).filter(p => p.isConfigured());
}

/**
 * content_distributions.platform → SocialProvider 해석.
 * - 'instagram_caption' | 'instagram_carousel' → instagram
 * - 'threads_post' → threads
 */
export function resolveProviderFromPlatformKey(platformKey: string): SocialProvider | null {
  if (platformKey.startsWith('instagram')) return getProvider('instagram');
  if (platformKey === 'threads_post') return getProvider('threads');
  return null;
}

export type { SocialProvider, SocialPlatform };
export * from './types';
