import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeCronRouteAuth, hasFailClosedRegisteredInngestHandler } from './automation-guards.mjs';

const MARKERS = ['withCronGuard', 'requireCronBearer', 'isCronAuthorized', 'withAdminGuard'];

test('cron audit rejects comments, wrong provenance, ignored results, and local no-ops', () => {
  assert.equal(analyzeCronRouteAuth('// requireCronBearer(request)\nexport async function GET() {}', MARKERS), null);
  assert.equal(analyzeCronRouteAuth("import { requireCronBearer } from './fake';\nexport async function GET(request) { requireCronBearer(request); run(); }", MARKERS), null);
  assert.equal(analyzeCronRouteAuth("import { requireCronBearer } from '@/lib/cron-auth';\nexport async function GET(request) { requireCronBearer(request); run(); }", MARKERS), null);
  assert.equal(analyzeCronRouteAuth('function requireCronBearer() {}\nexport async function GET(request) { const error = requireCronBearer(request); if (error) return error; }', MARKERS), null);
  assert.equal(analyzeCronRouteAuth("import { requireCronBearer as isCronAuthorized } from '@/lib/cron-auth';\nexport async function GET(request) { if (!isCronAuthorized(request)) return denied(); run(); }", MARKERS), null);
  assert.equal(analyzeCronRouteAuth("import { isCronAuthorized } from '@/lib/cron-auth';\nexport async function GET(request) { runSensitive(); if (!isCronAuthorized(request)) return denied(); }", MARKERS), null);
});

test('cron audit accepts trusted wrappers and fail-closed handler guards', () => {
  assert.equal(analyzeCronRouteAuth("import { withCronGuard } from '@/lib/cron-auth';\nconst handler = async () => {}; export const GET = withCronGuard(handler);", MARKERS), 'withCronGuard');
  assert.equal(analyzeCronRouteAuth("import { requireCronBearer } from '@/lib/cron-auth';\nexport async function GET(request) { const error = requireCronBearer(request); if (error) return error; run(); }", MARKERS), 'requireCronBearer');
  assert.equal(analyzeCronRouteAuth("import { isCronAuthorized } from '@/lib/cron-auth';\nexport async function GET(request) { if (!isCronAuthorized(request)) return denied(); run(); }", MARKERS), 'isCronAuthorized');
  assert.equal(analyzeCronRouteAuth("import { isCronAuthorized } from '@/lib/cron-auth'; import { withCronLogging } from '@/lib/cron-observability'; const handler = async (request) => { if (!isCronAuthorized(request)) return denied(); run(); }; export const GET = withCronLogging('job', handler);", MARKERS), 'isCronAuthorized');
  assert.equal(analyzeCronRouteAuth("import { withAdminGuard } from '@/lib/admin-guard'; const handler = async () => {}; export const GET = withAdminGuard(handler);", MARKERS), 'withAdminGuard');
});

test('Inngest audit requires the trusted guard as the first registered handler statement', () => {
  const good = "import { isEnabled } from '@/inngest/runtime-policy';\nexport const fn = inngest.createFunction({}, async () => { if (!isEnabled()) return { skipped: true }; run(); });";
  const unusedHelper = "import { isEnabled } from '@/inngest/runtime-policy';\nfunction helper() { if (!isEnabled()) return; } export const fn = inngest.createFunction({}, async () => { run(); });";
  const late = "import { isEnabled } from '@/inngest/runtime-policy';\nexport const fn = inngest.createFunction({}, async () => { run(); if (!isEnabled()) return; });";
  const decoy = "import { isEnabled } from '@/inngest/runtime-policy';\nconst decoy = inngest.createFunction({}, async () => { if (!isEnabled()) return; }); export const fn = inngest.createFunction({}, async () => { run(); });";
  assert.equal(hasFailClosedRegisteredInngestHandler(good, 'isEnabled'), true);
  assert.equal(hasFailClosedRegisteredInngestHandler(unusedHelper, 'isEnabled'), false);
  assert.equal(hasFailClosedRegisteredInngestHandler(late, 'isEnabled'), false);
  assert.equal(hasFailClosedRegisteredInngestHandler(decoy, 'isEnabled'), false);
});
