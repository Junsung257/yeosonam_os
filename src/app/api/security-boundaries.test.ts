import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('production release security boundaries', () => {
  it('requires tenant authorization before RFQ bid claiming', () => {
    const route = source('src/app/api/rfq/[id]/bid/route.ts');
    expect(route).toContain('requireTenantPortalRequest');
    expect(route).toContain('claimAuthorizedRfqBid(rfqId, authorization.tenantId)');
    expect(route).not.toContain('claimRfqBid(rfqId, tenant_id)');
  });

  it('keeps proposal reads and writes on exact tenant/rfq/bid predicates', () => {
    const route = source('src/app/api/rfq/[id]/bid/[bidId]/proposal/route.ts');
    expect(route).toContain('requireTenantPortalRequest');
    expect(route).toContain('getAuthorizedRfqProposal');
    expect(route).toContain('createAuthorizedRfqProposal');
    expect(route).toContain('updateAuthorizedRfqProposal');
    expect(route).not.toContain('createRfqProposal');
    expect(route).not.toContain('updateRfqProposal');
  });

  it('does not expose the generic proposal collection publicly', () => {
    const route = source('src/app/api/rfq/[id]/proposals/route.ts');
    expect(route).toContain('requireAdminRequest');
    expect(route).toContain("'Cache-Control': 'private, no-store'");
  });

  it('uses one fail-closed OAuth state implementation everywhere', () => {
    const state = source('src/lib/oauth-state.ts');
    expect(state).toContain("getSecret('OAUTH_STATE_SECRET')?.trim()");
    expect(state).toContain('timingSafeEqual');
    expect(state).toContain('consumed_at');
    expect(state).not.toContain("?? 'dev'");

    for (const route of [
      'google-callback',
      'meta-callback',
      'naver-callback',
    ]) {
      const callback = source(`src/app/api/auth/${route}/route.ts`);
      expect(callback).toContain('verifyOAuthState');
      expect(callback).toContain('consumeOAuthState');
      expect(callback).not.toContain("createHmac('sha256', process.env.OAUTH_STATE_SECRET || 'dev')");
    }
  });

  it('never resolves a tenant token without a tenant predicate', () => {
    const resolver = source('src/lib/marketing-pipeline/token-resolver.ts');
    expect(resolver).toContain('!isUuid(normalizedTenantId)');
    expect(resolver).toContain(".eq('tenant_id', normalizedTenantId)");
    expect(resolver).toContain('resolvePlatformOAuthToken');
    expect(resolver).not.toContain("if (tenantId.trim())");

    const publisher = source('src/lib/social-publisher.ts');
    expect(publisher).toContain(".eq('tenant_id', tenantId)");
    expect(publisher).toContain("tenantId: typeof row.tenant_id === 'string'");
    expect(publisher).toContain('resolvePublishingToken(request.tenantId');
    expect(publisher).toContain('getThreadsConfig()');
  });

  it('does not allow tenant publishing to fall back to platform credentials', () => {
    const publisher = source('src/lib/social-publisher.ts');
    expect(publisher).toContain('resolvePublishingAccountId');
    expect(publisher).toContain('테넌트 Twitter OAuth 토큰 없음');
    expect(publisher).toContain('PUBLISH_LEASE_MS');
    expect(publisher).toContain("publish_claim_token");
    expect(publisher).toContain(".eq('status', 'publishing')");
    expect(publisher).toContain("'instagram_business_account_id'");
    expect(publisher).toContain("'facebook_page_id'");
    expect(publisher).toContain("'threads_user_id'");
    expect(publisher).toContain("'naver_cafe_id'");
    expect(publisher).toContain('Twitter user-context publisher is not configured');
    expect(publisher).not.toContain('externalPostId: `tw_${Date.now()}`');
    expect(publisher).toContain('requiresReconciliation');
    expect(publisher).toContain("'needs_reconcile'");
  });

  it('requires a human actor for platform OAuth and reads Threads DB credentials', () => {
    const adminGuard = source('src/lib/admin-guard.ts');
    expect(adminGuard).toContain('requireHumanAdminActor');
    const threadsStart = source('src/app/api/auth/threads-oauth-start/route.ts');
    expect(threadsStart).toContain('requireHumanAdminActor');
    const socialConfig = source('src/app/api/admin/social-configs/route.ts');
    expect(socialConfig).toContain('requireHumanAdminActor');
    const threadsConfig = source('src/lib/threads-publisher.ts');
    expect(threadsConfig).toContain("resolveSystemSecret('THREADS_USER_ID')");
    const migration = source('supabase/migrations/20260828130000_social_publishing_hardening.sql');
    expect(migration).toContain("'publishing'");
    expect(migration).toContain('publish_lease_expires_at');
    expect(migration).toContain("'twitter'");
  });
});
