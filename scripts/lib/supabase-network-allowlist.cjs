'use strict';

const PRODUCTION_SUPABASE_HOSTNAME = 'ixaxnvbmhzjvupissmly.supabase.co';

function parseSupabaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('Supabase URL must be a valid absolute URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Supabase URL must use HTTPS for network allowlisting');
  }

  return {
    origin: parsed.origin,
    hostname: parsed.hostname.toLowerCase(),
    websocketOrigin: `wss://${parsed.host}`,
  };
}

function getSupabaseNetworkPolicy({ vercelEnv, urls = [] }) {
  const configuredUrls = Array.isArray(urls) ? urls : [urls];
  const parsedUrls = configuredUrls
    .map(parseSupabaseUrl)
    .filter(Boolean);
  const unique = [...new Map(parsedUrls.map((item) => [item.origin, item])).values()];

  if (vercelEnv === 'preview' && unique.some((item) => item.hostname === PRODUCTION_SUPABASE_HOSTNAME)) {
    throw new Error(
      `Preview must not allow the production Supabase origin: ${PRODUCTION_SUPABASE_HOSTNAME}`,
    );
  }

  if (vercelEnv === 'production' && unique.some((item) => item.hostname !== PRODUCTION_SUPABASE_HOSTNAME)) {
    throw new Error(
      `Production must use only the approved Supabase origin: ${PRODUCTION_SUPABASE_HOSTNAME}`,
    );
  }

  return {
    origins: unique.map((item) => item.origin),
    hostnames: unique.map((item) => item.hostname),
    websocketOrigins: unique.map((item) => item.websocketOrigin),
    remotePatterns: unique.map((item) => ({
      protocol: 'https',
      hostname: item.hostname,
    })),
  };
}

module.exports = {
  PRODUCTION_SUPABASE_HOSTNAME,
  getSupabaseNetworkPolicy,
};
