import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog admin live operations contract', () => {
  it('keeps recent operational failures inside the queue audit window', () => {
    const route = source('src/app/api/blog/queue/route.ts');
    const createdOrder = route.indexOf(".order('created_at', { ascending: false })");
    const targetOrder = route.indexOf(".order('target_publish_at', { ascending: true, nullsFirst: false })");

    expect(createdOrder).toBeGreaterThan(0);
    expect(targetOrder).toBeGreaterThan(createdOrder);
  });

  it('honors dashboard scope drilldowns on the first render', () => {
    const page = source('src/app/admin/blog/queue/page.tsx');
    const client = source('src/app/admin/blog/queue/BlogQueueClient.tsx');
    const statusStrip = source('src/app/admin/blog/BlogOpsStatusStrip.tsx');

    expect(page).toContain('const params = await searchParams');
    expect(page).toContain('resolveBlogQueueAdminView(params.scope, params.status)');
    expect(client).toContain("initialView = 'active'");
    expect(client).toContain('useState<(typeof VIEW_TABS)[number]');
    expect(statusStrip).toContain("'/admin/blog/queue?scope=attention'");
  });

  it('shows the DB policy as the only executable volume truth', () => {
    const policyPage = source('src/app/admin/blog/policy/page.tsx');
    const systemPage = source('src/app/admin/blog/system/page.tsx');

    expect(policyPage).toContain('DB 설정이 발행량의 단일 기준');
    expect(policyPage).not.toContain('BLOG_DAILY_PUBLISH_CAP');
    expect(systemPage).toContain('자동발행 실효 정책');
    expect(systemPage).toContain('V3 운영 DB 준비상태');
  });

  it('persists authenticated admin topic additions as editor-approved demand', () => {
    const route = source('src/app/api/blog/queue/route.ts');

    expect(route).toContain('editor_approved_seed: true');
    expect(route).toContain("editor_approval_channel: 'admin_blog_queue'");
    expect(route).toContain('demand_source_reference: `admin_blog_queue:add_topic:${editorApprovedAt}`');
  });
});
