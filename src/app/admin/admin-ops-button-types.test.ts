import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'src/app/admin/content-calendar/CalendarPageContent.tsx',
  'src/app/admin/jarvis/components/AgentActionsPanel.tsx',
  'src/app/admin/kakao-import/page.tsx',
  'src/app/admin/scoring/page.tsx',
  'src/app/admin/affiliates/[id]/page.tsx',
  'src/app/admin/destinations/page.tsx',
  'src/app/admin/extractions/corrections/page.tsx',
  'src/app/admin/inbox/page.tsx',
  'src/app/admin/jarvis/page.tsx',
  'src/app/admin/marketing/page.tsx',
  'src/app/admin/upload/page.tsx',
  'src/components/admin/ContentReviewPanel.tsx',
  'src/app/admin/applications/page.tsx',
  'src/app/admin/blog/[id]/page.tsx',
  'src/app/admin/blog/queue/BlogQueueClient.tsx',
  'src/app/admin/blog/write/page.tsx',
  'src/app/admin/bookings/[id]/BookingDetailClient.tsx',
  'src/app/admin/bookings/BookingsPageClient.tsx',
  'src/app/admin/registration-monitor/page.tsx',
  'src/app/admin/settings/integrations/page.tsx',
  'src/app/admin/terms-templates/[id]/page.tsx',
  'src/components/admin/ApprovalModal.tsx',
  'src/components/admin/CampaignLinkBuilder.tsx',
] as const;

const buttonWithoutTypePattern = /<button\b(?![^>]*\btype=)[^>]*>/g;

describe('admin operations action buttons', () => {
  it.each(files)('%s declares an explicit button type', (file) => {
    const source = readFileSync(file, 'utf8');

    expect(source.match(buttonWithoutTypePattern) ?? []).toEqual([]);
  });
});
