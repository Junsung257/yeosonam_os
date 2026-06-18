#!/usr/bin/env node

const fs = require('node:fs');
const https = require('node:https');

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const timeoutMs = Number(process.env.DB_HEALTH_TIMEOUT_MS || '5000');

function requestRestRoot() {
  return new Promise((resolve) => {
    if (!supabaseUrl || !serviceKey) {
      resolve({ status: 'skipped', notes: 'Supabase URL or service role key is not configured' });
      return;
    }

    const startedAt = Date.now();
    const url = new URL(`${supabaseUrl}/rest/v1/`);
    const request = https.get(url, {
      timeout: timeoutMs,
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      },
    }, (res) => {
      res.resume();
      res.on('end', () => {
        resolve({
          status: res.statusCode >= 200 && res.statusCode < 500 ? 'reachable' : 'down',
          statusCode: res.statusCode,
          responseTimeMs: Date.now() - startedAt,
          notes: res.statusCode >= 200 && res.statusCode < 500 ? 'rest endpoint reachable' : 'server error',
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => {
      resolve({
        status: 'down',
        statusCode: null,
        responseTimeMs: Date.now() - startedAt,
        notes: error.code || error.message,
      });
    });
  });
}

(async () => {
  const connectivity = await requestRestRoot();
  const report = {
    timestamp: new Date().toISOString(),
    connectivity,
    thresholds: {
      responseTimeMs: Number(process.env.DB_HEALTH_RESPONSE_MS || '1000'),
    },
    status: connectivity.status === 'down' ? 'fail' : connectivity.status === 'skipped' ? 'skipped' : 'pass',
  };

  fs.writeFileSync('db-health-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Database health: ${report.status} - ${connectivity.notes}`);
  if (connectivity.responseTimeMs !== undefined) console.log(`Response: ${connectivity.responseTimeMs}ms`);

  if (report.status === 'fail') process.exit(1);
})();
