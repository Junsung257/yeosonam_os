import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(
    join(process.cwd(), 'src/app/api/agent/approvals/[id]/route.ts'),
    'utf8',
  );
}

describe('agent approval decision boundary', () => {
  it('fails closed on malformed or unknown actions', () => {
    const source = routeSource();

    expect(source).toContain("action: z.enum(['approve', 'reject'])");
    expect(source).toContain('DecisionSchema.safeParse(rawBody)');
    expect(source).not.toContain("body?.action === 'reject' ? 'reject' : 'approve'");
  });

  it('blocks overdue requests and detects concurrent decisions', () => {
    const source = routeSource();

    expect(source).toContain('isAgentApprovalOverdue(approval)');
    expect(source).toContain(".eq('status', 'pending')");
    expect(source).toContain(".select('id')");
    expect(source).toContain('if (!updatedApproval)');
  });

  it('uses the shared admin guard before entering the mutation handler', () => {
    const source = routeSource();

    expect(source).toContain('export const POST = withAdminGuard(postHandler)');
  });
});
