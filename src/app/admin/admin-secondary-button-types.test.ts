import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const adminSecondaryOperationScreens = [
  'src/app/admin/affiliates/[id]/page.tsx',
  'src/app/admin/applications/page.tsx',
  'src/app/admin/blog/[id]/page.tsx',
  'src/app/admin/blog/queue/BlogQueueClient.tsx',
  'src/app/admin/blog/write/page.tsx',
  'src/app/admin/bookings/[id]/BookingDetailClient.tsx',
  'src/app/admin/bookings/BookingsPageClient.tsx',
  'src/app/admin/content-calendar/CalendarPageContent.tsx',
  'src/app/admin/destinations/page.tsx',
  'src/app/admin/extractions/corrections/page.tsx',
  'src/app/admin/inbox/page.tsx',
  'src/app/admin/jarvis/components/AgentActionsPanel.tsx',
  'src/app/admin/jarvis/page.tsx',
  'src/app/admin/kakao-import/page.tsx',
  'src/app/admin/marketing/page.tsx',
  'src/app/admin/registration-monitor/page.tsx',
  'src/app/admin/scoring/page.tsx',
  'src/app/admin/settings/integrations/page.tsx',
  'src/app/admin/terms-templates/[id]/page.tsx',
  'src/app/admin/upload/page.tsx',
  'src/components/admin/ApprovalModal.tsx',
  'src/components/admin/CampaignLinkBuilder.tsx',
  'src/components/admin/ContentReviewPanel.tsx',
];

describe('admin secondary operation button types', () => {
  it.each(adminSecondaryOperationScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
