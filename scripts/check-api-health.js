#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const baseUrl = (process.env.MONITOR_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com').replace(/\/$/, '');
const timeoutMs = Number(process.env.MONITOR_API_TIMEOUT_MS || '5000');

function endpoints() {
  if (process.env.MONITOR_HEALTH_ENDPOINTS) {
    try {
      return JSON.parse(process.env.MONITOR_HEALTH_ENDPOINTS);
    } catch {
      // Fall through to defaults.
    }
  }
  return [
    { name: 'Packages API', url: `${baseUrl}/api/packages?limit=1` },
    { name: 'Health Check', url: `${baseUrl}/api/health` },
    { name: 'Marketing System Health', url: `${baseUrl}/api/admin/marketing/system-health` },
  ];
}

function checkEndpoint(endpoint) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const url = new URL(endpoint.url);
    const client = url.protocol === 'http:' ? http : https;
    const request = client.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => {
        const responseTimeMs = Date.now() - startedAt;
        const reachable = res.statusCode >= 200 && res.statusCode < 500;
        const healthy = res.statusCode >= 200 && res.statusCode < 300;
        resolve({
          ...endpoint,
          statusCode: res.statusCode,
          responseTimeMs,
          status: healthy ? 'healthy' : reachable ? 'degraded' : 'down',
          notes: healthy ? 'ok' : reachable ? 'reachable but not successful' : 'server error',
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) => {
      resolve({
        ...endpoint,
        statusCode: null,
        responseTimeMs: Date.now() - startedAt,
        status: 'down',
        notes: error.code || error.message,
      });
    });
  });
}

(async () => {
  const results = await Promise.all(endpoints().map(checkEndpoint));
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    healthy: results.filter((item) => item.status === 'healthy'),
    degraded: results.filter((item) => item.status === 'degraded'),
    down: results.filter((item) => item.status === 'down'),
    results,
  };

  fs.writeFileSync('api-health-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(`API health: healthy=${report.healthy.length} degraded=${report.degraded.length} down=${report.down.length}`);
  for (const item of results) {
    console.log(`${item.status.toUpperCase()} ${item.name} ${item.statusCode ?? 'n/a'} ${item.responseTimeMs}ms - ${item.notes}`);
  }

  if (report.down.length > 0) process.exit(1);
})();
