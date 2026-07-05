#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { extractPriceIR } from '../src/lib/parser/deterministic/price-ir/index.ts';

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env.croncheck.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const daysArg = Number(process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1] ?? 3);
const limitArg = Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? 500);
const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 3;
const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(limitArg, 2000) : 500;
const includeArchived = process.argv.includes('--include-archived');
const publicOnly = process.argv.includes('--public-only');
const jsonOnly = process.argv.includes('--json');
const strict = process.argv.includes('--strict');
const repairPriceStorage = process.argv.includes('--repair-price-storage');
const repairPriceTiers = process.argv.includes('--repair-price-tiers');
const repairPriceSourceEvidence = process.argv.includes('--repair-price-source-evidence');
const repairItineraryDisplay = process.argv.includes('--repair-itinerary-display');
const repairExcludeFragments = process.argv.includes('--repair-exclude-fragments');
const repairDurationTripStyle = process.argv.includes('--repair-duration-trip-style');
const repairEmptyItineraryDays = process.argv.includes('--repair-empty-itinerary-days');
const demoteUnsafePublic = process.argv.includes('--demote-unsafe-public');
const archiveFailedNonPublic = process.argv.includes('--archive-failed-nonpublic');
const verifyPublicHtml = process.argv.includes('--verify-public-html');
const baseArg = process.argv.find(arg => arg.startsWith('--base='))?.split('=')[1]?.trim();
const codeFilter = (process.argv.find(arg => arg.startsWith('--codes='))?.split('=')[1] ?? '')
  .split(',')
  .map(code => code.trim())
  .filter(Boolean);
const packageIdFilter = (process.argv.find(arg => arg.startsWith('--package-ids='))?.split('=')[1] ?? '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
function isLocalBaseUrl(value) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(String(value || '').trim());
}

function resolveSiteBaseUrl() {
  if (baseArg) return baseArg;
  const publicBase = process.env.NEXT_PUBLIC_BASE_URL;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (publicOnly && verifyPublicHtml && isLocalBaseUrl(publicBase) && siteUrl) return siteUrl;
  return publicBase || siteUrl || 'https://www.yeosonam.com';
}

const siteBaseUrl = String(resolveSiteBaseUrl()).replace(/\/+$/, '');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function todayKstDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

function isPlaceholderSecret(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized === 'xxx'
    || normalized === 'placeholder'
    || normalized.includes('your_')
    || normalized.includes('replace_me');
}

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (isPlaceholderSecret(serviceKey)) {
  console.error('Invalid Supabase admin configuration: service role key is a placeholder.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const PUBLIC_STATUSES = new Set(['approved', 'active', 'published']);
const ARCHIVED_STATUSES = new Set(['archived', 'inactive']);

async function replaceProductPricesForProduct(productId, rows) {
  const payload = rows.map(row => ({
    target_date: row.target_date ?? null,
    day_of_week: row.day_of_week ?? null,
    net_price: Number(row.net_price),
    adult_selling_price: Number(row.adult_selling_price ?? row.net_price),
    child_price: row.child_price ?? null,
    note: row.note ?? null,
  }));
  const { data, error } = await supabase.rpc('replace_product_prices_for_product', {
    p_product_id: productId,
    p_rows: payload,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? payload.length);
}

async function checkSupabaseRestHealth() {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.DB_HEALTH_TIMEOUT_MS || '15000');
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${String(url).replace(/\/+$/, '')}/rest/v1/`, {
      signal: controller.signal,
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        accept: 'application/json',
      },
      cache: 'no-store',
    });
    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      response_time_ms: Date.now() - startedAt,
      reason: response.status >= 200 && response.status < 400 ? 'rest endpoint reachable' : `rest endpoint returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      response_time_ms: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function failDatabasePreflight(health) {
  const payload = {
    status: 'blocked',
    reason: 'DB_HEALTHCHECK_TIMEOUT_OR_UNREACHABLE',
    message: 'Supabase REST/Data API is not healthy enough for mobile/A4 readiness audit.',
    supabase_health: health,
  };
  if (jsonOnly) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(`${payload.reason}: ${health.reason} (${health.response_time_ms}ms)`);
  }
  process.exit(1);
}

const supabaseHealth = await checkSupabaseRestHealth();
const requireHealthyPreflight = process.env.DB_HEALTHCHECK_REQUIRED === '1'
  || process.argv.includes('--strict-healthcheck');
if (!supabaseHealth.ok && requireHealthyPreflight) failDatabasePreflight(supabaseHealth);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSupabaseQuery(label, queryFactory) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let result;
    try {
      result = await queryFactory();
    } catch (error) {
      result = { data: null, error };
    }
    lastResult = result;
    if (!result.error) return result;
    const message = String(result.error.message ?? result.error);
    if (!/fetch failed|timeout|network|ECONNRESET|ETIMEDOUT/i.test(message)) break;
    if (attempt < 3) await sleep(250 * attempt);
  }
  if (lastResult?.error) {
    console.error(`${label} lookup failed: ${lastResult.error.message ?? lastResult.error}`);
  }
  return lastResult;
}

function chunks(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchProductPricesByCodes(codes) {
  const rowsByCode = new Map();
  const countsByCode = new Map();
  const errors = [];

  for (const code of codes) {
    const { data, error } = await runSupabaseQuery(
      `Product price rows ${code}`,
      () => supabase
        .from('product_prices')
        .select('product_id, target_date, net_price, adult_selling_price, note')
        .eq('product_id', code),
    );
    if (error) {
      errors.push({ code, message: error.message ?? String(error) });
      continue;
    }
    for (const price of data ?? []) {
      const key = price.product_id;
      countsByCode.set(key, (countsByCode.get(key) ?? 0) + 1);
      const rows = rowsByCode.get(key) ?? [];
      rows.push(price);
      rowsByCode.set(key, rows);
    }
  }

  return { rowsByCode, countsByCode, errors };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isArchivedStatus(status) {
  return ARCHIVED_STATUSES.has(String(status ?? '').toLowerCase());
}

function isPublicStatus(status) {
  return PUBLIC_STATUSES.has(String(status ?? '').toLowerCase());
}

function flattenNoticeText(pkg) {
  const notices = Array.isArray(pkg.notices_parsed) ? pkg.notices_parsed : [];
  return [
    ...notices.map(notice => typeof notice === 'string' ? notice : [notice?.title, notice?.text].filter(Boolean).join('\n')),
    typeof pkg.customer_notes === 'string' ? pkg.customer_notes : '',
  ].join('\n');
}

function hasStandardNoticeMeta(pkg) {
  return Array.isArray(pkg.notices_parsed)
    && pkg.notices_parsed.some(notice => isRecord(notice) && notice.template_key && notice.review_status && notice.category);
}

function hasStructuredNoticeItems(pkg) {
  return Array.isArray(pkg.notices_parsed)
    && pkg.notices_parsed.length > 0
    && pkg.notices_parsed.every(notice => {
      if (!isRecord(notice)) return false;
      const title = String(notice.title ?? '').trim();
      const text = String(notice.text ?? '').trim();
      const type = String(notice.type ?? notice.category ?? '').trim();
      return title && text && type;
    });
}

function hasRawLeakRisk(pkg) {
  const text = flattenNoticeText(pkg);
  if (!text.trim()) return false;
  if (hasStandardNoticeMeta(pkg) || hasStructuredNoticeItems(pkg)) return false;
  return /REMARK|\uB9AC\uB9C8\uD06C|\uB79C\uB4DC\uC0AC\s*(?:\uBE44\uACE0|\uC548\uB0B4)|\uC5EC\uAD8C\s*6\uAC1C\uC6D4|\uC804\uC790\s*\uB2F4\uBC30\s*\uBC18\uC785|\uB8F8\s*\uBC30\uC815|\uC77C\uC815\s*\uBBF8\uCC38\uC5EC|\uB9C8\uC0AC\uC9C0\s*\uD301|\uC2F1\uAE00\s*\uCC28\uC9C0|single\s*charge/i.test(text);
}

function trustScore(row) {
  const issues = [];
  const add = (condition, code, severity, deduction) => {
    if (condition) issues.push({ code, severity, deduction });
  };
  const hardV3Blocked = row.v3 === 'blocked' && (
    row.entity_attraction_unresolved > 0
    || row.entity_unknown_customer_visible > 0
    || Boolean(row.render_failure)
    || Boolean(row.public_html_failure)
  );
  add(row.code_unk, 'code.unk', 'critical', 80);
  add(row.raw_notice_leak_risk, 'notice.raw_leak_risk', 'critical', 100);
  add(row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0, 'price.missing', 'critical', 35);
  add(row.price_storage_mismatch, 'price.storage_mismatch', 'critical', 60);
  add(row.customer_price_option_mismatch, 'price.customer_option_mismatch', 'critical', 60);
  add(row.product_ledger_price_mismatch, 'price.product_ledger_mismatch', 'critical', 60);
  add(row.price_tiers_mismatch, 'price.tiers_mismatch', 'critical', 60);
  add(row.price_source_evidence_mismatch, 'price.source_evidence_mismatch', 'critical', 70);
  add(row.attraction_context_mismatch, 'attraction.context_mismatch', 'critical', 80);
  add(row.attraction_unlinked_registered, 'attraction.unlinked_registered', 'critical', 80);
  add(row.attraction_description_missing, 'attraction.description_missing', 'critical', 60);
  add(row.itinerary_semantic_mismatch, 'itinerary.semantic_mismatch', 'critical', 70);
  add(row.duration_trip_style_mismatch, 'landing.duration_trip_style_mismatch', 'critical', 70);
  add(row.hotel_field_semantic_mismatch, 'itinerary.hotel_field_semantic_mismatch', 'critical', 80);
  add(row.exclude_fragment_corruption, 'catalog.exclude_fragment_corruption', 'critical', 70);
  add(row.optional_tour_surcharge_pollution, 'catalog.optional_tour_surcharge_pollution', 'critical', 70);
  add(row.render_failure, 'render.blocked', 'critical', 80);
  add(row.public_html_failure, 'render.public_html_failure', 'critical', 100);
  add(row.itinerary_policy_leak, 'itinerary.policy_leak', 'critical', 80);
  add(row.itinerary_days === 0, 'itinerary.missing', 'critical', 35);
  add(row.v3 === 'lookup_failed', 'v3.lookup_failed', 'critical', 40);
  add(hardV3Blocked, 'v3.blocked', 'critical', 40);
  add(row.v3 === 'needs_review', 'v3.needs_review', 'high', 20);
  add(row.v3 === 'none', 'v3.missing', 'high', 25);
  add(row.standard_notices === 0 && row.structured_facts === 0, 'v3.facts_missing', 'medium', 15);
  add(row.entity_attraction_unresolved > 0, 'entity.attraction_unresolved', 'high', Math.min(30, 10 + row.entity_attraction_unresolved * 5));
  add(row.entity_shopping_review_needed > 0, 'entity.shopping_review_needed', 'high', Math.min(20, 8 + row.entity_shopping_review_needed * 3));
  add(row.entity_option_review_needed > 0, 'entity.option_review_needed', 'high', Math.min(20, 8 + row.entity_option_review_needed * 3));
  add(row.entity_unknown_customer_visible > 0, 'entity.unknown_customer_visible', 'high', Math.min(25, 10 + row.entity_unknown_customer_visible * 5));
  add(row.unmatched_activities > 0, 'attraction.unmatched', 'medium', Math.min(20, 5 + Math.ceil(row.unmatched_activities / 10)));
  const score = issues.some(issue => issue.severity === 'critical' && issue.deduction >= 100)
    ? 0
    : Math.max(0, 100 - issues.reduce((sum, issue) => sum + issue.deduction, 0));
  return {
    score,
    publishable: score === 100 && issues.every(issue => issue.severity !== 'critical' && issue.severity !== 'high'),
    blockers: issues.filter(issue => issue.severity === 'critical' || issue.severity === 'high').map(issue => issue.code),
    warnings: issues.filter(issue => issue.severity === 'medium' || issue.severity === 'low').map(issue => issue.code),
  };
}

function countItineraryDays(pkg) {
  const days = pkg.itinerary_data?.days;
  if (Array.isArray(days)) return days.length;
  if (Array.isArray(pkg.itinerary)) return pkg.itinerary.length;
  return 0;
}

function parseTripStyle(value) {
  const match = String(value ?? '').match(/(\d+)\s*\uBC15\s*(\d+)\s*\uC77C/);
  if (!match) return null;
  return { nights: Number(match[1]), days: Number(match[2]) };
}

function durationTripStyleMismatch(pkg) {
  const trip = parseTripStyle(pkg.trip_style ?? pkg.title);
  if (!trip) return null;
  const duration = Number(pkg.duration);
  const nights = Number(pkg.nights);
  const metaNights = Number(pkg.itinerary_data?.meta?.nights);
  const metaDays = Number(pkg.itinerary_data?.meta?.days);
  if (Number.isFinite(duration) && duration > 0 && duration !== trip.days) {
    return `duration ${duration} != trip_style days ${trip.days}`;
  }
  if (Number.isFinite(nights) && nights >= 0 && nights !== trip.nights) {
    return `nights ${nights} != trip_style nights ${trip.nights}`;
  }
  if (Number.isFinite(metaDays) && metaDays > 0 && metaDays !== trip.days) {
    return `itinerary_data.meta.days ${metaDays} != trip_style days ${trip.days}`;
  }
  if (Number.isFinite(metaNights) && metaNights >= 0 && metaNights !== trip.nights) {
    return `itinerary_data.meta.nights ${metaNights} != trip_style nights ${trip.nights}`;
  }
  return null;
}

function repairDurationTripStyleValues(pkg) {
  const trip = parseTripStyle(pkg.trip_style ?? pkg.title);
  if (!trip) return null;
  const nextItineraryData = pkg.itinerary_data && typeof pkg.itinerary_data === 'object'
    ? structuredClone(pkg.itinerary_data)
    : null;
  const nextMeta = nextItineraryData && typeof nextItineraryData.meta === 'object'
    ? { ...nextItineraryData.meta }
    : null;
  const before = {
    duration: pkg.duration ?? null,
    nights: pkg.nights ?? null,
    meta_days: nextMeta?.days ?? null,
    meta_nights: nextMeta?.nights ?? null,
  };
  const patch = {};
  if (Number(pkg.duration) !== trip.days) patch.duration = trip.days;
  if (Number(pkg.nights) !== trip.nights) patch.nights = trip.nights;
  if (nextItineraryData && nextMeta) {
    let metaChanged = false;
    if (Number(nextMeta.days) !== trip.days) {
      nextMeta.days = trip.days;
      metaChanged = true;
    }
    if (Number(nextMeta.nights) !== trip.nights) {
      nextMeta.nights = trip.nights;
      metaChanged = true;
    }
    if (metaChanged) {
      nextItineraryData.meta = nextMeta;
      patch.itinerary_data = nextItineraryData;
    }
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    patch,
    before,
    after: {
      duration: patch.duration ?? pkg.duration ?? null,
      nights: patch.nights ?? pkg.nights ?? null,
      meta_days: patch.itinerary_data?.meta?.days ?? nextMeta?.days ?? null,
      meta_nights: patch.itinerary_data?.meta?.nights ?? nextMeta?.nights ?? null,
    },
  };
}

function hotelFieldSemanticMismatch(pkg) {
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days : [];
  for (const day of days) {
    const name = String(day?.hotel?.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const compact = name.replace(/\s+/g, '');
    const hasMovement = /(\uBBF8\uD305|\uACF5\uD56D|\uC774\uB3D9|\uCD9C\uBC1C|\uB3C4\uCC29|\uCCB4\uD06C\uC544\uC6C3|\uB77C\uC6B4\uB529)/.test(compact);
    const looksLikeHotelName = /([\uAC00-\uD7A3A-Za-z0-9]{2,}\uD638\uD154|\uB9AC\uC870\uD2B8|\uACE8\uD504\uD154|hotel|resort|\uB3D9\uAE09|\d\s*\uC131)/i.test(name);
    if (hasMovement && !looksLikeHotelName) {
      return `day ${day?.day ?? '?'} hotel.name is movement/schedule text: ${name}`;
    }
  }
  return null;
}

function excludeFragmentCorruption(pkg) {
  const excludes = Array.isArray(pkg.excludes) ? pkg.excludes.map(item => String(item ?? '').trim()).filter(Boolean) : [];
  for (let i = 0; i < excludes.length; i++) {
    const item = excludes[i];
    if (/^\uC77C\s*\uC8FC\uB9D0/.test(item)) return `exclude fragment starts with Sunday/weekend tail: ${item}`;
    if (/\uC11D\uC2DD\s*\*?\s*\uD1A0$/.test(item)) return `exclude fragment split at Sat/Sun comma: ${item}`;
    if (/\b\d{1,3}$/.test(item) && /^\d{3}\s*\uC6D0/.test(excludes[i + 1] ?? '')) {
      return `exclude money amount split across comma: ${item} / ${excludes[i + 1]}`;
    }
  }
  return null;
}

function repairExcludeFragmentList(excludes) {
  if (!Array.isArray(excludes)) return null;
  const next = [];
  const removed = [];
  let changed = false;
  for (let i = 0; i < excludes.length; i++) {
    const item = String(excludes[i] ?? '').replace(/\s+/g, ' ').trim();
    if (!item) {
      changed = true;
      continue;
    }
    if (/^\uC635\s*\uC158$/i.test(item)) {
      removed.push(item);
      changed = true;
      continue;
    }
    const following = String(excludes[i + 1] ?? '').replace(/\s+/g, ' ').trim();
    if (/\b\d{1,3}$/.test(item) && /^\d{3}\s*\uC6D0/.test(following)) {
      const prefix = item.replace(/\s*(\d{1,3})$/, '');
      const amountHead = item.match(/(\d{1,3})$/)?.[1] ?? '';
      next.push(`${prefix}${amountHead},${following}`.replace(/\s+/g, ' ').trim());
      removed.push(item, following);
      i += 1;
      changed = true;
      continue;
    }
    next.push(item);
  }
  return changed ? { excludes: next, removed } : null;
}

function optionalTourSurchargePollution(pkg) {
  const tours = Array.isArray(pkg.optional_tours) ? pkg.optional_tours : [];
  for (const tour of tours) {
    const text = [tour?.name, tour?.note].filter(Boolean).join(' ');
    if (/(\uCE74\uD2B8\uBE44|\uC2F1\uAE00\s*\uCE74\uD2B8|\uCD94\uAC00\s*(?:\uB429\uB2C8\uB2E4|\uC694\uAE08|\uBE44\uC6A9|\uAE08)|\uB77C\uC6B4\uB529\uC2DC|2B|3B|single\s*cart|cart\s*fee)/i.test(text)) {
      return `optional_tours contains surcharge/fee text: ${text}`;
    }
  }
  return null;
}

function isMealOnlyDisplayRow(item) {
  const activity = String(item?.activity ?? '').replace(/\s+/g, ' ').trim();
  return /^(?:\uD638\uD154\s*)?\uC870\uC2DD\s*\uD6C4$|^\uC911\uC2DD\s*\uD6C4$|^\uC11D\uC2DD\s*\uD6C4$/.test(activity);
}

function repairItineraryDisplayQuality(pkg) {
  const itineraryData = pkg.itinerary_data && typeof pkg.itinerary_data === 'object'
    ? JSON.parse(JSON.stringify(pkg.itinerary_data))
    : null;
  const days = Array.isArray(itineraryData?.days) ? itineraryData.days : [];
  if (days.length === 0) return null;

  const removed = [];
  for (const day of days) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    const nextSchedule = [];
    for (const item of schedule) {
      if (isMealOnlyDisplayRow(item)) {
        removed.push({ day: day?.day ?? null, activity: String(item?.activity ?? '').replace(/\s+/g, ' ').trim() });
        continue;
      }
      nextSchedule.push(item);
    }
    day.schedule = nextSchedule;
  }

  if (removed.length === 0) return null;
  return { itinerary_data: itineraryData, removed };
}

function repairEmptyItineraryDaysQuality(pkg) {
  const itineraryData = pkg.itinerary_data && typeof pkg.itinerary_data === 'object'
    ? JSON.parse(JSON.stringify(pkg.itinerary_data))
    : null;
  const days = Array.isArray(itineraryData?.days) ? itineraryData.days : [];
  if (days.length === 0) return null;

  const destination = String(pkg.destination ?? itineraryData?.meta?.destination ?? '').replace(/\s+/g, ' ').trim();
  const filled = [];
  for (const day of days) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    if (schedule.length > 0) continue;
    const region = String((Array.isArray(day?.regions) ? day.regions[0] : null) ?? destination).replace(/\s+/g, ' ').trim();
    const place = region || destination;
    if (!place) continue;
    const activity = `${place} 현지 일정 진행`;
    day.schedule = [{
      note: '세부 일정은 상품 상담 시 안내',
      time: null,
      type: 'free_time',
      badge: null,
      activity,
      transport: null,
      a4_sentence: activity,
      entity_kind: 'free_time',
      service_name: null,
      service_detail: null,
      attraction_query: null,
      landing_sentence: activity,
    }];
    filled.push({ day: day?.day ?? null, activity });
  }

  return filled.length > 0 ? { itinerary_data: itineraryData, filled } : null;
}

function hasUnresolvedCodeOrDestination(pkg) {
  const code = String(pkg.internal_code ?? pkg.short_code ?? '');
  const destination = String(pkg.destination ?? '').trim();
  return !destination || destination === 'UNK' || /(?:^|-)UNK(?:-|$)/.test(code);
}

function hasItineraryPolicyLeak(pkg) {
  const visibleDays = Array.isArray(pkg.itinerary_data?.days)
    ? pkg.itinerary_data.days
    : Array.isArray(pkg.itinerary)
      ? pkg.itinerary
      : [];
  return visibleDays.some(day => {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    return schedule.some(item => {
      const activity = String(item?.activity ?? '');
      return /(?:취소\s*규정|취소\s*수수료|예약금\s*수수료|위약금|환불\s*불가|300,000)/i.test(activity);
    });
  });

  const days = Array.isArray(pkg.itinerary_data?.days)
    ? pkg.itinerary_data.days
    : Array.isArray(pkg.itinerary)
      ? pkg.itinerary
      : [];
  return days.some(day => {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    return schedule.some(item => {
      const activity = String(item?.activity ?? '');
      return /취소\s*규정|취소\s*수수료|현금영수증|특별\s*약관|예약금|수수료|환불|300,000/i.test(activity);
    });
  });
}

function normalizedPriceDates(pkg) {
  return (Array.isArray(pkg.price_dates) ? pkg.price_dates : [])
    .filter(row => row?.date && Number(row?.price) > 0)
    .map(row => ({
      product_id: pkg.internal_code,
      target_date: row.date,
      day_of_week: null,
      net_price: Number(row.price),
      adult_selling_price: Number(row.price),
      child_price: null,
      note: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null,
    }));
}

function validPackagePriceDates(pkg) {
  return (Array.isArray(pkg.price_dates) ? pkg.price_dates : [])
    .filter(row => (
      typeof row?.date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && Number.isFinite(Number(row.price))
      && Number(row.price) > 0
    ))
    .map(row => ({
      date: row.date,
      price: Number(row.price),
      child_price: Number.isFinite(Number(row.child_price)) && Number(row.child_price) > 0
        ? Number(row.child_price)
        : null,
      confirmed: row.confirmed === true,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function minimumPackagePrice(priceDates) {
  const prices = priceDates.map(row => Number(row.price)).filter(price => Number.isFinite(price) && price > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function priceTiersFromPackagePriceDates(priceDates) {
  const groupedByPrice = new Map();
  for (const row of priceDates) {
    const rows = groupedByPrice.get(row.price) ?? [];
    rows.push(row);
    groupedByPrice.set(row.price, rows);
  }

  return [...groupedByPrice.entries()]
    .sort((a, b) => a[1][0].date.localeCompare(b[1][0].date))
    .map(([price, rows]) => {
      const childPrices = rows
        .map(row => row.child_price)
        .filter(childPrice => Number.isFinite(Number(childPrice)) && Number(childPrice) > 0)
        .map(Number);
      return {
        period_label: 'source-backed departure dates',
        departure_dates: rows.map(row => row.date),
        adult_price: price,
        ...(childPrices.length > 0 ? { child_price: Math.min(...childPrices) } : {}),
        status: rows.some(row => row.confirmed) ? 'confirmed' : 'available',
      };
    });
}

function unsupportedPriceEvidenceDate(message) {
  return String(message ?? '').match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null;
}

function pruneUnsupportedPriceDates(pkg, productPriceRows) {
  const priceDates = validPackagePriceDates(pkg);
  if (priceDates.length === 0) return null;
  const draft = { ...pkg, price_dates: priceDates };
  const removed = [];
  for (let attempt = 0; attempt < priceDates.length; attempt++) {
    const mismatch = priceDateSourceEvidenceMismatch(draft, productPriceRows);
    if (!mismatch) break;
    const date = unsupportedPriceEvidenceDate(mismatch);
    if (!date) {
      return {
        ok: false,
        reason: mismatch,
        removed,
        price_dates: draft.price_dates,
      };
    }
    const before = draft.price_dates.length;
    draft.price_dates = draft.price_dates.filter(row => row.date !== date);
    if (draft.price_dates.length === before) {
      return {
        ok: false,
        reason: mismatch,
        removed,
        price_dates: draft.price_dates,
      };
    }
    removed.push({ date, reason: mismatch });
    if (draft.price_dates.length === 0) {
      return {
        ok: false,
        reason: 'all_price_dates_lack_source_evidence',
        removed,
        price_dates: [],
      };
    }
  }
  const finalMismatch = priceDateSourceEvidenceMismatch(draft, productPriceRows);
  return {
    ok: !finalMismatch,
    reason: finalMismatch,
    removed,
    price_dates: draft.price_dates,
  };
}

function priceStorageMismatch(pkg, productPriceRows) {
  const priceDates = Array.isArray(pkg.price_dates) ? [...pkg.price_dates].filter(row => row?.date) : [];
  const datedRows = productPriceRows.filter(row => row?.target_date);
  const priceDateByDate = new Map();
  for (const row of priceDates) {
    priceDateByDate.set(row.date, Number(row.price));
  }
  const pricesByDate = new Map();
  for (const row of datedRows) {
    const price = Number(row.net_price);
    if (!row.target_date || !Number.isFinite(price) || price <= 0) continue;
    const prices = pricesByDate.get(row.target_date) ?? [];
    prices.push(price);
    pricesByDate.set(row.target_date, prices);
  }
  if (priceDates.length === 0) {
    return pricesByDate.size > 0 ? 'price_dates missing all product_prices dates' : null;
  }
  for (const targetDate of pricesByDate.keys()) {
    if (!priceDateByDate.has(targetDate)) return `price_dates missing date ${targetDate}`;
  }
  for (const priceDate of priceDates) {
    const prices = pricesByDate.get(priceDate.date);
    if (!prices || prices.length === 0) return `product_prices missing date ${priceDate.date}`;
    const minPrice = Math.min(...prices);
    if (minPrice !== Number(priceDate.price)) {
      return `${priceDate.date} product_prices min ${minPrice} != price_dates ${Number(priceDate.price)}`;
    }
  }
  return null;
}

function productLedgerPriceMismatch(pkg, productRow) {
  if (!productRow) return null;
  const packagePrice = Number(pkg.price);
  const productNetPrice = Number(productRow.net_price);
  if (!Number.isFinite(packagePrice) || packagePrice <= 0) return null;
  if (!Number.isFinite(productNetPrice) || productNetPrice <= 0) {
    return `products.net_price missing for ${pkg.internal_code}`;
  }
  if (packagePrice !== productNetPrice) {
    return `products.net_price ${productNetPrice} != travel_packages.price ${packagePrice}`;
  }
  return null;
}

const PROVENANCE_LABEL_RE = /(?:source_|pdf_date_price_table|human_reader|document_raw|evidenceSpanId|evidenceHash|sourcePriceIrId)/i;

function isCustomerSafePriceLabel(value) {
  const trimmed = String(value ?? '').trim();
  return Boolean(trimmed) && !PROVENANCE_LABEL_RE.test(trimmed);
}

function customerPriceOptionLabels(rows) {
  const options = rows
    .map(row => {
      const price = Number(row?.adult_selling_price ?? row?.net_price);
      if (!Number.isFinite(price) || price <= 0) return null;
      const note = String(row?.note ?? '').trim();
      return {
        label: isCustomerSafePriceLabel(note) ? note : '',
        price,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.price - b.price || a.label.localeCompare(b.label, 'ko-KR'));
  const counts = new Map();
  for (const option of options) {
    if (!option.label) continue;
    counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  }
  return options.map((option, index) => (
    !option.label || (counts.get(option.label) ?? 0) > 1
      ? `요금 옵션 ${index + 1}`
      : option.label
  ));
}

function priceTiersMismatch(pkg, productPriceRows = []) {
  const priceDates = Array.isArray(pkg.price_dates)
    ? pkg.price_dates
        .map(row => Number(row?.price))
        .filter(price => Number.isFinite(price) && price > 0)
    : [];
  const tierPrices = Array.isArray(pkg.price_tiers)
    ? pkg.price_tiers
        .map(row => Number(row?.adult_price))
        .filter(price => Number.isFinite(price) && price > 0)
    : [];
  if (priceDates.length === 0 || tierPrices.length === 0) return null;

  const minDatePrice = Math.min(...priceDates);
  const minTierPrice = Math.min(...tierPrices);
  if (minTierPrice < minDatePrice) {
    return `price_tiers min ${minTierPrice} < price_dates min ${minDatePrice}`;
  }

  const productPriceSet = new Set(productPriceRows
    .map(row => Number(row?.adult_selling_price ?? row?.net_price))
    .filter(price => Number.isFinite(price) && price > 0));
  const allowedPriceSet = new Set([...priceDates, ...productPriceSet]);
  const unknownTierPrice = tierPrices.find(price => !allowedPriceSet.has(price));
  if (unknownTierPrice) {
    return `price_tiers price ${unknownTierPrice} not found in price_dates/product_prices`;
  }
  return null;
}

function customerPriceOptionMismatch(pkg, productPriceRows) {
  const priceDates = Array.isArray(pkg.price_dates) ? [...pkg.price_dates].filter(row => row?.date) : [];
  if (priceDates.length === 0) return null;

  const rowsByDate = new Map();
  for (const row of productPriceRows) {
    if (!row?.target_date) continue;
    const rows = rowsByDate.get(row.target_date) ?? [];
    rows.push(row);
    rowsByDate.set(row.target_date, rows);
  }

  for (const priceDate of priceDates) {
    const rows = rowsByDate.get(priceDate.date) ?? [];
    if (rows.length === 0) return `customer product price options missing date ${priceDate.date}`;
    const missingSelling = rows.find(row => {
      const selling = Number(row.adult_selling_price);
      return !Number.isFinite(selling) || selling <= 0;
    });
    if (missingSelling) return `adult_selling_price missing for ${priceDate.date}`;

    if (rows.length > 1) {
      const labels = customerPriceOptionLabels(rows);
      if (labels.length < rows.length) return `customer option label missing for ${priceDate.date}`;
      if (new Set(labels).size < rows.length) return `customer option labels duplicated for ${priceDate.date}`;
    }
  }

  return null;
}

function priceDateSourceEvidenceMismatch(pkg, productPriceRows = []) {
  const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates.filter(row => row?.date && Number(row?.price) > 0) : [];
  const raw = String(pkg.raw_text ?? '');
  if (priceDates.length === 0 || !raw.trim()) return null;
  const today = todayKstDateKey();
  const firstPriceYear = Number(String(priceDates[0]?.date ?? '').slice(0, 4));
  const deterministicPriceIr = extractPriceIR(raw, {
    year: Number.isFinite(firstPriceYear) && firstPriceYear >= 2000 ? firstPriceYear : undefined,
    title: pkg.title ?? undefined,
    durationDays: typeof pkg.duration === 'number' ? pkg.duration : null,
    departureDays: pkg.departure_days ?? null,
    accommodations: Array.isArray(pkg.accommodations) ? pkg.accommodations : [],
  });
  const deterministicPriceIrCovers = row => deterministicPriceIr.rows.some(irRow =>
    irRow.date === row.date && Number(irRow.adult_price) === Number(row.price));
  const lines = raw.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim());
  const dateOnlyRe = /^\d{1,2}\s*\uC6D4\s*\d{1,2}\s*\uC77C(?:\s*\([^)]+\))?$/;
  const headerRe = /^(?:\d{1,2}\s*\uC6D4|\uC6D4\uC694\uC77C|\uD654\uC694\uC77C|\uC218\uC694\uC77C|\uBAA9\uC694\uC77C|\uAE08\uC694\uC77C|\uD1A0\uC694\uC77C|\uC77C\uC694\uC77C|\uCD9C\s*\uBC1C\s*\uC77C|\uD328\uD134|\uc77c\s*\uc790|\uC120\ud0dd\uAD00\uAD11|\uC1FC\uD551\uC13C\uD130|---)$/;
  const amountFor = price => {
    const n = Number(price);
    return Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';
  };
  const amountVariantsFor = price => {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return [];
    const full = n.toLocaleString('ko-KR');
    const short = Math.round(n / 1000).toLocaleString('ko-KR');
    return [...new Set([full, full.replace(/,/g, ''), short, short.replace(/,/g, ''), `${short},-`].filter(Boolean))];
  };
  const lineHasAmount = (line, price) => {
    const compactLine = String(line ?? '').replace(/\s+/g, '');
    return amountVariantsFor(price).some(amount => compactLine.includes(amount.replace(/\s+/g, '')));
  };
  const hasAllowedProductPriceProvenance = priceRow => {
    const note = String(priceRow?.note ?? '').trim();
    if (!note) return false;
    return /(?:source_|pdf_date_price_table|human_reader|document_raw|evidenceSpanId|evidenceHash|sourcePriceIrId)/i.test(note);
  };
  const productPriceProvenanceCovers = row => productPriceRows.some(priceRow => {
    if (priceRow?.target_date !== row.date) return false;
    const storedAmount = Number(priceRow.adult_selling_price ?? priceRow.net_price);
    if (!Number.isFinite(storedAmount) || storedAmount !== Number(row.price)) return false;
    return hasAllowedProductPriceProvenance(priceRow);
  });
  const dateLabel = iso => {
    const [, , month, day] = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
    if (!month || !day) return null;
    return `${Number(month)}\uC6D4${Number(day)}\uC77C`;
  };
  const slashDateLabel = iso => {
    const [, , month, day] = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
    if (!month || !day) return null;
    return `${Number(month)}/${Number(day)}`;
  };
  const compactDateTokenOccurs = (compactLine, token) => {
    if (!token) return false;
    const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(compactLine);
  };
  const isoParts = iso => {
    const [, year, month, day] = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
    if (!year || !month || !day) return null;
    return { year: Number(year), month: Number(month), day: Number(day) };
  };
  const dateToDayNumber = ({ year, month, day }) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 86400000) : null;
  };
  const parseSlashRange = (line, year) => {
    const compact = String(line ?? '').replace(/\s+/g, '');
    const explicit = compact.match(/(\d{1,2})\/(\d{1,2})[~-](\d{1,2})\/(\d{1,2})/);
    const sameMonth = compact.match(/(\d{1,2})\/(\d{1,2})[~-](\d{1,2})(?!\/)/);
    const match = explicit ?? sameMonth;
    if (!match) return null;
    const start = dateToDayNumber({ year, month: Number(match[1]), day: Number(match[2]) });
    const end = dateToDayNumber({
      year,
      month: explicit ? Number(match[3]) : Number(match[1]),
      day: Number(explicit ? match[4] : match[3]),
    });
    if (start == null || end == null) return null;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  };
  const parseSlashDateList = (line, year) => {
    const compact = String(line ?? '').replace(/\s+/g, '');
    const match = compact.match(/^(\d{1,2})\/(\d{1,2}(?:,\d{1,2})+)$/);
    if (!match) return [];
    const month = Number(match[1]);
    return match[2]
      .split(',')
      .map(day => dateToDayNumber({ year, month, day: Number(day) }))
      .filter(day => day != null);
  };
  const parseMixedSlashDateList = (line, year) => {
    const compact = String(line ?? '').replace(/\s+/g, '');
    if (!/^\d{1,2}\/\d{1,2}(?:,\d{1,2}(?:\/\d{1,2})?)+$/.test(compact)) return [];
    let month = null;
    const out = [];
    for (const token of compact.split(',')) {
      const slash = token.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (slash) {
        month = Number(slash[1]);
        const day = dateToDayNumber({ year, month, day: Number(slash[2]) });
        if (day != null) out.push(day);
        continue;
      }
      if (month != null && /^\d{1,2}$/.test(token)) {
        const day = dateToDayNumber({ year, month, day: Number(token) });
        if (day != null) out.push(day);
      }
    }
    return out;
  };
  const parseEmbeddedSlashDates = (line, year) => {
    const normalized = String(line ?? '').replace(/\s+/g, ' ');
    const compact = String(line ?? '').replace(/\s+/g, '');
    const out = [];
    for (const match of normalized.matchAll(/(^|[^0-9])(\d{1,2})\/(\d{1,2})(?=$|[^0-9/])/g)) {
      const month = Number(match[2]);
      const day = Number(match[3]);
      const dayNumber = dateToDayNumber({ year, month, day });
      if (dayNumber != null) out.push(dayNumber);
    }
    for (const match of compact.matchAll(/(^|[^0-9])(\d{1,2})\/(\d{1,2}(?:,\d{1,2})+)(?=$|[^0-9/])/g)) {
      const month = Number(match[2]);
      for (const dayText of match[3].split(',')) {
        const dayNumber = dateToDayNumber({ year, month, day: Number(dayText) });
        if (dayNumber != null) out.push(dayNumber);
      }
    }
    for (const match of compact.matchAll(/(^|[^0-9])(\d{1,2})\/(\d{1,2})(?:([^0-9]|\b))/g)) {
      const month = Number(match[2]);
      const day = Number(match[3]);
      const dayNumber = dateToDayNumber({ year, month, day });
      if (dayNumber != null) out.push(dayNumber);
    }
    return out;
  };
  const parseKoreanMonthDayList = (line, year) => {
    const compact = String(line ?? '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, '');
    const out = [];
    for (const match of compact.matchAll(/(\d{1,2})\uC6D4(\d{1,2}(?:,\d{1,2})*)(?:\uC77C|(?=[^0-9]|$))/g)) {
      const month = Number(match[1]);
      for (const dayText of match[2].split(',')) {
        const dayNumber = dateToDayNumber({ year, month, day: Number(dayText) });
        if (dayNumber != null) out.push(dayNumber);
      }
    }
    return out;
  };
  const dateNumbersInLine = (line, year) => [
    ...parseSlashDateList(line, year),
    ...parseMixedSlashDateList(line, year),
    ...parseEmbeddedSlashDates(line, year),
    ...parseKoreanMonthDayList(line, year),
  ];
  const tableDayNumbersInLine = (line, year, month) => {
    const compact = String(line ?? '').replace(/\s+/g, '');
    if (!month || !compact) return [];
    if (/(?:원|월|출발|상품|붉은색|초록색|확정|임박|일-수|일,월|목|금|토|특정일)/.test(compact)) return [];
    const dayList = compact.replace(/일$/, '');
    if (!/^\d{1,2}(?:,\d{1,2})*$/.test(dayList)) return [];
    return dayList
      .split(',')
      .map(day => dateToDayNumber({ year, month, day: Number(day) }))
      .filter(day => day != null);
  };
  const nearestKoreanMonthBefore = (lineIndex) => {
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 40); i--) {
      const match = String(lines[i] ?? '').replace(/\s+/g, '').match(/^(\d{1,2})월$/);
      if (match) return Number(match[1]);
      if (/^\[.+\]/.test(lines[i] ?? '') && i !== lineIndex) break;
    }
    return null;
  };
  const verticalTableEvidenceCovers = row => {
    const parts = isoParts(row.date);
    if (!parts) return false;
    const target = dateToDayNumber(parts);
    if (target == null) return false;
    for (let i = 0; i < lines.length; i++) {
      if (!lineHasAmount(lines[i], row.price)) continue;
      const month = nearestKoreanMonthBefore(i);
      if (month !== parts.month) continue;
      const dayNumbers = lines
        .slice(Math.max(0, i - 8), i)
        .flatMap(line => tableDayNumbersInLine(line, parts.year, month));
      if (dayNumbers.includes(target)) return true;
    }
    return false;
  };
  const parseKoreanDateOnlyLine = (line, year) => {
    const compact = String(line ?? '').replace(/\s+/g, '');
    const match = compact.match(/^(?:(20\d{2})년)?(\d{1,2})월(\d{1,2})일$/);
    if (!match) return null;
    return dateToDayNumber({
      year: Number(match[1] ?? year),
      month: Number(match[2]),
      day: Number(match[3]),
    });
  };
  const rangeEvidenceCovers = row => {
    const parts = isoParts(row.date);
    if (!parts) return false;
    const target = dateToDayNumber(parts);
    if (target == null) return false;
    for (let i = 0; i < lines.length; i++) {
      const range = parseSlashRange(lines[i], parts.year);
      if (!range || target < range.start || target > range.end) continue;
      let end = Math.min(lines.length, i + 80);
      for (let j = i + 1; j < end; j++) {
        const nextRange = parseSlashRange(lines[j], parts.year);
        if (nextRange && (target < nextRange.start || target > nextRange.end)) {
          end = j;
          break;
        }
        if (/^(?:\uC81C\s*\d+\s*\uC77C|DAY\s*\d+|\uD3EC\uD568|\uBD88\uD3EC\uD568|\uC120\ud0dd\uAD00\uAD11|\uC1FC\uD551|\uCDE8\uC18C|\uC57D\uAD00)/i.test(lines[j])) {
          end = j;
          break;
        }
      }
      const window = lines.slice(i, end);
      if (window.some(line => lineHasAmount(line, row.price))) return true;
    }
    return false;
  };
  const rangeLineWithProductPriceProvenanceCovers = row => {
    const parts = isoParts(row.date);
    if (!parts || !productPriceProvenanceCovers(row)) return false;
    const target = dateToDayNumber(parts);
    if (target == null) return false;
    return lines.some(line => {
      const range = parseSlashRange(line, parts.year);
      return Boolean(range && target >= range.start && target <= range.end);
    });
  };
  const dateListEvidenceCovers = row => {
    const parts = isoParts(row.date);
    if (!parts) return false;
    const target = dateToDayNumber(parts);
    if (target == null) return false;
    for (let i = 0; i < lines.length; i++) {
      const dates = dateNumbersInLine(lines[i], parts.year);
      const koreanDate = parseKoreanDateOnlyLine(lines[i], parts.year);
      if (koreanDate != null) {
        dates.push(koreanDate);
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
          const nextKoreanDate = parseKoreanDateOnlyLine(lines[j], parts.year);
          if (nextKoreanDate == null) break;
          dates.push(nextKoreanDate);
        }
      }
      if (!dates.includes(target)) continue;
      const window = lines.slice(i, Math.min(lines.length, i + 10));
      if (window.some(line => lineHasAmount(line, row.price))) return true;
    }
    return false;
  };

  for (const row of priceDates) {
    if (typeof row.date === 'string' && row.date < today) continue;
    const label = dateLabel(row.date);
    const slashLabel = slashDateLabel(row.date);
    const amount = amountFor(row.price);
    if (!label || !amount) continue;
    const parts = isoParts(row.date);
    const target = parts ? dateToDayNumber(parts) : null;
    const starts = lines.reduce((indices, line, index) => {
      const compact = line.replace(/\s+/g, '');
      if (
        compact.includes(label)
        || compactDateTokenOccurs(compact, slashLabel)
        || (parts && target != null && dateNumbersInLine(line, parts.year).includes(target))
      ) {
        indices.push(index);
      }
      return indices;
    }, []);
    if (starts.length === 0) {
      if (deterministicPriceIrCovers(row)) continue;
      if (productPriceProvenanceCovers(row)) continue;
      if (rangeEvidenceCovers(row) || dateListEvidenceCovers(row) || verticalTableEvidenceCovers(row)) continue;
      return `source missing date ${row.date}`;
    }

    let found = false;
    let sawAnotherDateBeforePrice = false;
    for (const start of starts) {
      let localSawAnotherDateBeforePrice = false;
      for (let i = start; i < Math.min(lines.length, start + 9); i++) {
        const line = lines[i];
        if (!line) continue;
        if (i > start && dateOnlyRe.test(line)) {
          localSawAnotherDateBeforePrice = true;
          break;
        }
        if (i > start && headerRe.test(line)) break;
        if (lineHasAmount(line, row.price)) {
          found = true;
          break;
        }
      }
      sawAnotherDateBeforePrice = sawAnotherDateBeforePrice || localSawAnotherDateBeforePrice;
      if (found) break;
    }
    if ((!found || sawAnotherDateBeforePrice) && !rangeEvidenceCovers(row) && !dateListEvidenceCovers(row) && !verticalTableEvidenceCovers(row)) {
      if (deterministicPriceIrCovers(row)) continue;
      if (productPriceProvenanceCovers(row)) continue;
      if (rangeLineWithProductPriceProvenanceCovers(row)) continue;
      return `source price evidence missing for ${row.date} ${amount}`;
    }
  }
  return null;
}

function normalizeTerm(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '').trim();
}

function isMatchableAttractionRow(attraction) {
  return !attraction?.category || !['accommodation', 'hotel', 'mrt_product'].includes(String(attraction.category));
}

function isBadRegisteredAttractionTerm(term) {
  const normalized = normalizeTerm(term);
  if (!normalized || /^\d+(?:분|시간|m)$/.test(normalized)) return true;
  if (new Set([
    '\uC57C\uC2DC\uC7A5',
    '\uC2DC\uB0B4',
    '\uC2DC\uB0B4\uAD00\uAD11',
    '\uC2DC\uB0B4\uC911\uC2EC\uAC00',
    '\uD50C\uB77C\uC6CC\uAC00\uB4E0',
    '\uC57C\uACBD',
    '\uB9E5\uC8FC',
    '\uBB34\uC81C\uD55C',
    '(\uBB34\uC81C\uD55C',
    '\uC8FC\uB958\uBB34\uC81C\uD55C)',
    '\uC74C\uB8CC/\uC8FC\uB958\uBB34\uC81C\uD55C)',
    '\uB180\uC774\uACF5\uC6D0',
    'or',
    '\uD639\uC740',
    '\uC815\uADDC',
    '\uC99D\uD3B8',
    '\uAC00\uC774\uB4DC\uBBF8\uD305',
  ]).has(normalized)) return true;
  return /(?:마사지|오일마사지|전통마사지|전신마사지|발마사지|쇼핑센터|\uC808\uB300\uAE08\uC5F0|\uC804\uC790\uB2F4\uBC30|\uC218\uC601\uBCF5|\uC900\uBE44|\uC81C\uACF5|\uAD6C\uC785|\uAC00\uB2A5|\uC774\uC6A9\uAC00\uB2A5|\uBB34\uC81C\uD55C|\uC2DC\uC74C|\uC74C\uB8CC|\uCEE4\uD53C|\uB9E5\uC8FC|\uC815\uADDC|\uC99D\uD3B8|\uD558\uC774\uB514\uB77C\uC624|\uD558\uC774\uB2E4\uB77C\uC624|\uB78D\uC2A4\uD130|\uC81C\uC721\uC30C\uBC25|^or$|\bor\b)/i.test(normalized);
}

function isBadRegisteredAttractionTermV2(term) {
  const normalized = normalizeTerm(term);
  if (/(?:\uB3C4\uCC29|\uAC00\uC774\uB4DC\uBBF8\uD305|\uBBF8\uD305|\uD638\uD154\uD22C\uC219)/.test(normalized)) return true;
  if (/(?:\uB3C4\uBCF4|\uC804\uB3D9\uCE74|\uC720\uB9AC\uC804\uB9DD\uB300|\uC785\uAD6C|\uBD80\uB450|\uC720\uB78C\uC120)/.test(normalized)
    && !/(?:\uD611\uACE1|\uD48D\uACBD\uAD6C|\uC0B0|\uC0AC|\uAD81|\uC131|\uACF5\uC6D0)$/.test(normalized)) return true;
  return isBadRegisteredAttractionTerm(term);
}

function isUnsafeRegisteredAttractionAlias(term, attraction) {
  if (isBadRegisteredAttractionTermV2(term)) return true;
  const normalized = normalizeTerm(term);
  const canonical = normalizeTerm(attraction?.name);
  if (canonical && normalized === canonical) return false;
  if (canonical && (normalized.includes(canonical) || canonical.includes(normalized))) return false;
  const hasScope = Boolean(normalizeTerm(attraction?.region) || normalizeTerm(attraction?.country));
  if (!hasScope && normalized.length < 5) return true;
  if (!hasScope && /[\uAC00-\uD7A3]/.test(String(term ?? ''))) return true;
  if (/[\uAC00-\uD7A3]/.test(String(term ?? '')) && normalized.length > 12 && canonical && !normalized.includes(canonical)) {
    return true;
  }
  return false;
}

function destinationAllowsAttraction(destination, attraction, context = '') {
  const dest = normalizeTerm(destination);
  const ctx = normalizeTerm(context);
  if (!dest) return true;
  const region = normalizeTerm(attraction?.region);
  if (!region) return true;
  const guilinScope = /(?:계림|구이린|귀이린|양삭|부산-계림)/;
  if (guilinScope.test(dest) && guilinScope.test(region)) return true;
  const regionTokens = region.split(/[,/|&]+/).map(token => token.trim()).filter(Boolean);
  if (dest.includes(region) || region.includes(dest)) return true;
  if (ctx.includes(region) || regionTokens.some(token => token.length >= 2 && ctx.includes(token))) return true;
  if (
    /(?:\uC5F0\uAE38|\uBC31\uB450\uC0B0|\uC7A5\uBC31\uC0B0|\uBC31\uB450|\uC5F0\uBCC0)/.test(dest)
    && /(?:\uC5F0\uAE38|\uBC31\uB450\uC0B0|\uC7A5\uBC31\uC0B0|\uC5F0\uBCC0|\uB3C4\uBB38|\uC6A9\uC815|\uC1A1\uAC15\uD558|\uC774\uB3C4\uBC31\uD558|\uB0A8\uD30C|\uBD81\uD30C|\uC11C\uD30C)/.test(region)
  ) return true;
  return regionTokens.some(token => token.length >= 2 && dest.includes(token));
}

function directTermOccursInSchedule(text, term) {
  const normalizedText = normalizeTerm(text);
  const normalizedTerm = normalizeTerm(term);
  if (normalizedTerm.length < 3) return false;
  return normalizedText.includes(normalizedTerm);
}

function hasCustomerVisibleAttractionHint(text) {
  const compact = normalizeTerm(text);
  return /(?:\uAD00\uAD11|\uBC29\uBB38|\uC0B0\uCC45|\uCCB4\uD5D8|\uC21C\uB840|\uC870\uB9DD|\uAC15\uBCC0\uACF5\uC6D0|\uD3ED\uD3EC|\uD638\uC218|\uBBFC\uC18D\uCD0C|\uCC9C\uC9C0|\uC628\uCC9C\uC9C0\uB300|\uACBD\uACC4\uBE44|\uB300\uD611\uACE1|\uACE0\uC0B0\uD654\uC6D0|\uAD11\uC7A5|\uC0DD\uAC00|\uAD50\uD68C)/.test(compact);
}

function isTransferOnlyAttractionContext(text) {
  const compact = normalizeTerm(text);
  if (!/(?:\uB85C\uC774\uB3D9|\uC73C\uB85C\uC774\uB3D9|\uC774\uB3D9|\uC18C\uC694)/.test(compact)) return false;
  return !hasCustomerVisibleAttractionHint(text);
}

function unlinkedRegisteredAttractionTerm(pkg, attractionTerms) {
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days : [];
  for (const day of days) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    const dayContext = Array.isArray(day?.regions) ? day.regions.join(' ') : '';
    for (const item of schedule) {
      const ids = Array.isArray(item?.attraction_ids) ? item.attraction_ids.filter(Boolean) : [];
      if (ids.length > 0) continue;
      const activity = String(item?.activity ?? '').replace(/\s+/g, ' ').trim();
      if (!activity) continue;
      if (/^\d{1,2}[./-]\d{1,2}(?:\s*\([^)]+\))?$/.test(activity)) continue;
      if (/(?:추천옵션|선택\s*관광|\$\s*\d+|USD\s*\d+|\/\s*인)/i.test(activity)) continue;
      const type = String(item?.type ?? item?.entity_kind ?? '').toLowerCase();
      if (['flight', 'hotel', 'meal', 'transfer', 'shopping', 'optional_tour', 'notice', 'free_time', 'price_noise'].includes(type)) continue;
      const itemText = [activity, item?.note].filter(Boolean).join(' ');
      const context = [itemText, dayContext].filter(Boolean).join(' ');
      if (isTransferOnlyAttractionContext(context)) continue;
      for (const term of attractionTerms) {
        if (!destinationAllowsAttraction(pkg.destination, term.attraction, context)) continue;
        if (!directTermOccursInSchedule(itemText, term.term)) continue;
        return `${activity}: registered attraction "${term.attraction.name}" appears but attraction_ids is empty`;
      }
    }
  }
  return null;
}

function attractionContextMismatch(pkg, attractionById) {
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days : [];
  for (const day of days) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    for (const item of schedule) {
      const ids = Array.isArray(item?.attraction_ids) ? item.attraction_ids.filter(Boolean) : [];
      for (const id of ids) {
        const attraction = attractionById.get(String(id));
        if (!attraction) continue;
        const dayContext = Array.isArray(day?.regions) ? day.regions.join(' ') : '';
        const itemContext = [item.activity, item.note, dayContext].filter(Boolean).join(' ');
        if (!destinationAllowsAttraction(pkg.destination, attraction, itemContext)) {
          return `${item.activity ?? ''}: attraction ${attraction.name ?? id} region ${attraction.region ?? 'unknown'} mismatches destination ${pkg.destination ?? 'unknown'}`;
        }
      }
    }
  }
  return null;
}

function attractionDescriptionMissing(pkg, attractionById) {
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days : [];
  for (const day of days) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    for (const item of schedule) {
      const ids = Array.isArray(item?.attraction_ids) ? item.attraction_ids.filter(Boolean) : [];
      if (ids.length === 0) continue;
      const activity = String(item?.activity ?? '').replace(/\s+/g, ' ').trim();
      const itemNote = String(item?.attraction_note ?? '').trim();
      for (const id of ids) {
        const attraction = attractionById.get(String(id));
        if (!attraction) continue;
        const shortDesc = String(attraction.short_desc ?? '').trim();
        const longDesc = String(attraction.long_desc ?? '').trim();
        if (!shortDesc && !longDesc && !itemNote) {
          return `${activity}: attraction ${attraction.name ?? id} has no customer description`;
        }
      }
    }
  }
  return null;
}

function itinerarySemanticMismatch(pkg) {
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days : [];
  const routeOnlyRe = /^(?:\uBD80\s*\uC0B0|\uC5F0\s*\uAE38|\uB3C4\s*\uBB38|\uC6A9\s*\uC815|\uC774\uB3C4\uBC31\uD558|\uC1A1\uAC15\uD558|\uB0A8\s*\uD30C|\uBD81\s*\uD30C|\uC11C\s*\uD30C)$/;
  const mealOnlyRe = /^(?:\uD638\uD154\uC2DD|\uD604\uC9C0\uC2DD|\uAE40\uBC25|\uB0C9\uBA74|\uAFC8\uBC14\uB85C\uC6B0|\uAFD4\uBC14\uB85C\uC6B0|\uC0E4\uBE0C\uC0E4\uBE0C|\uC0BC\uACB9\uC0B4|\uC591\uAF2C\uCE58|\uBE44\uBE54\uBC25|\uBB34\uC81C\uD55C|\uB9E4\uC6B4\uD0D5|\uC624\uB9AC\uAD6C\uC774|\uC0B0\uCC9C\uC5B4\uD68C)$/;
  for (const day of days) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    for (const item of schedule) {
      const activity = String(item?.activity ?? '').replace(/\s+/g, ' ').trim();
      const compact = activity.replace(/\s+/g, '');
      const kind = String(item?.entity_kind ?? '');
      const type = String(item?.type ?? '');
      const hasAttraction = Array.isArray(item?.attraction_ids) && item.attraction_ids.length > 0;
      if (!activity) continue;
      if (routeOnlyRe.test(compact)) return `day ${day?.day ?? '?'} route-only token visible: ${activity}`;
      if (/^(?:\uD638\uD154\s*)?\uC870\uC2DD\s*\uD6C4|^\uC911\uC2DD\s*\uD6C4|^\uC11D\uC2DD\s*\uD6C4/.test(activity)) {
        return `day ${day?.day ?? '?'} embedded meal phrase visible in schedule: ${activity}`;
      }
      if (mealOnlyRe.test(compact)) return `day ${day?.day ?? '?'} meal token visible in schedule: ${activity}`;
      if (kind === 'meal' || type === 'meal') return `day ${day?.day ?? '?'} meal entity visible in schedule: ${activity}`;
      if (kind === 'hotel_stay') return `day ${day?.day ?? '?'} hotel stay visible in schedule: ${activity}`;
      if (type === 'hotel' && /(?:HOTEL|hotel|\uD638\uD154).*(?:\uB3D9\uAE09|\([^)]+\uC131[^)]*\))/.test(activity) && !/(?:\uC628\uCC9C\uC695|\uCCB4\uD5D8|\uD2B9\uC804|\uC0C1\uB2F9)/.test(activity)) {
        return `day ${day?.day ?? '?'} hotel token visible in schedule: ${activity}`;
      }
      if (type === 'flight' || kind === 'flight') {
        const flightLike = /\b[A-Z0-9]{2}\s*\d{3,4}\b/.test(activity)
          || (/\uACF5\uD56D/.test(activity) && /(\uCD9C\uBC1C|\uB3C4\uCC29|\uBBF8\uD305)/.test(activity))
          || (/(\uCD9C\uBC1C|\uB3C4\uCC29)$/.test(compact) && !/(\uAD00\uAD11|\uCCB4\uD5D8|\uB4F1\uC815|\uC0B0\uCC45|\uC870\uB9DD)/.test(activity));
        if (!flightLike) return `day ${day?.day ?? '?'} non-flight line classified as flight: ${activity}`;
      }
      const golfLike = /(?:\uB77C\uC6B4\uB529|\uACE8\uD504\uC7A5|\bCC\b|CC\s*\d|\uC5D0\uC2A4\uCE04\uB9AC\s*CC|\uBE48\uD384\s*CC)/i.test(activity);
      if ((kind === 'attraction_visit' || hasAttraction) && !golfLike && /(?:HOTEL|hotel|\uD638\uD154|\uC8FC\uC810|\uB3D9\uAE09|\uC900\s*5\uC131|\uC815\s*5\uC131|5\uC131)/.test(activity)) {
        return `day ${day?.day ?? '?'} hotel-like line classified as attraction: ${activity}`;
      }
    }
  }
  return null;
}

function renderFailure(pkg) {
  try {
    const priceFrom = Number(pkg.price);
    const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates.filter(row => row?.date && Number(row?.price) > 0) : [];
    const days = Array.isArray(pkg.itinerary_data?.days)
      ? pkg.itinerary_data.days
      : Array.isArray(pkg.itinerary)
        ? pkg.itinerary
        : [];
    if (!Number.isFinite(priceFrom) || priceFrom <= 0) return 'landing.priceFrom=0';
    if (priceDates.length === 0) return 'landing.price_dates=0';
    if (days.length === 0) return 'landing.itinerary.days=0';
    for (const day of days) {
      if (!Array.isArray(day?.schedule) || day.schedule.length === 0) return `landing.itinerary.day_${day?.day ?? '?'} schedule=0`;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function countLedgerRows(draft, key) {
  const variants = draft?.ledger?.variants;
  if (!Array.isArray(variants)) return 0;
  return variants.reduce((sum, variant) => sum + (Array.isArray(variant?.[key]) ? variant[key].length : 0), 0);
}

function gateStatus(draft, lookupFailed = false) {
  if (lookupFailed) return 'lookup_failed';
  return draft?.gate_result?.status ?? draft?.status ?? 'none';
}

function draftAttractionUnmatchedCount(draft) {
  const entityCount = Number(draft?.match_summary?.entity_summary?.attraction_unresolved_count);
  if (Number.isFinite(entityCount) && entityCount >= 0) return entityCount;
  const count = Number(draft?.match_summary?.attraction_unmatched_count);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function draftEntitySummary(draft) {
  const summary = draft?.match_summary?.entity_summary;
  return {
    attraction_unresolved: Number(summary?.attraction_unresolved_count ?? draft?.match_summary?.attraction_unmatched_count ?? 0) || 0,
    shopping_review_needed: Number(summary?.shopping_review_needed_count ?? 0) || 0,
    option_review_needed: Number(summary?.option_review_needed_count ?? draft?.match_summary?.option_review_count ?? 0) || 0,
    unknown_customer_visible: Number(summary?.unknown_customer_visible_count ?? 0) || 0,
    noise_removed: Number(summary?.auto_ignored_noise_count ?? 0) || 0,
    meal_structured: Number(summary?.meal_structured_count ?? 0) || 0,
    transfer_structured: Number(summary?.transfer_structured_count ?? 0) || 0,
  };
}

function htmlToVisibleText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, timeoutMs, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          accept: 'text/html,application/xhtml+xml',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      });
      if (response.status < 500 || attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(250 * attempt);
  }
  throw lastError ?? new Error(`fetch failed after ${attempts} attempts`);
}

async function verifyPublicHtmlSurfaceUrl(row, surface) {
  const url = `${siteBaseUrl}/${surface}/${encodeURIComponent(row.id)}?readiness=${Date.now()}`;
  let response;
  try {
    response = await fetchWithTimeout(url, 30_000);
  } catch (error) {
    return `${surface}: fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const html = await response.text().catch(error => `__READ_ERROR__ ${error instanceof Error ? error.message : String(error)}`);
  const text = htmlToVisibleText(html);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = htmlToVisibleText(titleMatch?.[1] ?? '');
  const missing = [];
  if (!response.ok) missing.push(`http_${response.status}`);
  if (/NOT_FOUND|Application error|FUNCTION_INVOCATION_TIMEOUT|Internal Server Error|Failed to fetch|client-side exception|server-side exception/i.test(text)) {
    missing.push('error_marker');
  }
  if (!/(?:\u20a9|\uc6d0|\ud310\ub9e4\uac00|\ucd5c\uc800\uac00)/u.test(text)) missing.push('price_marker');
  if (!/(?:\uc5ec\ud589\s*\uc77c\uc815|DAY\s*1|\uc77c\uc815\ud45c)/u.test(text)) missing.push('itinerary_marker');
  if (!/(?:\uc608\uc57d\s*\ubb38\uc758|\uce74\ud1a1|\uc0c1\ub2f4)/u.test(text)) missing.push('inquiry_marker');
  if (!title || title === '\uc0c1\ud488 \uc0c1\uc138 | \uc5ec\uc18c\ub0a8' || /^\uc5ec\uc18c\ub0a8\s*$/u.test(title)) {
    missing.push('specific_title');
  }
  const minVisibleTextLength = surface === 'lp' ? 500 : 1_500;
  if (text.length < minVisibleTextLength) missing.push(`body_too_short_${text.length}`);
  return missing.length > 0 ? `${surface}: ${url}: ${missing.join(', ')}` : null;
}

async function verifyPublicHtmlSurface(row) {
  if (!verifyPublicHtml || !row.public) return null;
  const failures = [];
  for (const surface of ['packages', 'lp']) {
    const failure = await verifyPublicHtmlSurfaceUrl(row, surface);
    if (failure) failures.push(failure);
  }
  return failures.length > 0 ? failures.join(' | ') : null;
}

function hasNeedsHumanSourceReview(row) {
  const report = row.audit_report && typeof row.audit_report === 'object' ? row.audit_report : {};
  const autopilot = report.upload_to_open_autopilot && typeof report.upload_to_open_autopilot === 'object'
    ? report.upload_to_open_autopilot
    : {};
  const repairFirstSummary = autopilot.repair_first_summary && typeof autopilot.repair_first_summary === 'object'
    ? autopilot.repair_first_summary
    : {};
  return autopilot.final_state === 'needs_human_source_review'
    || autopilot.status === 'needs_human_source_review'
    || autopilot.openabilityState === 'needs_human_source_review'
    || repairFirstSummary.state === 'needs_human_source_review'
    || row.audit === 'needs_human_source_review';
}

function isBlockingV3NeedsReview(row) {
  return row.v3 === 'needs_review' && (row.public || !hasNeedsHumanSourceReview(row));
}

function readinessFor(row) {
  const failures = [];
  const warnings = [];
  const nonPublicSourceReview = !row.public && hasNeedsHumanSourceReview(row);
  const addHumanReviewWarning = () => {
    if (!warnings.includes('needs_human_source_review')) warnings.push('needs_human_source_review');
  };
  const hardV3Blocked = row.v3 === 'blocked' && (
    row.entity_attraction_unresolved > 0
    || row.entity_unknown_customer_visible > 0
    || Boolean(row.render_failure)
    || Boolean(row.public_html_failure)
  );

  if (row.raw_notice_leak_risk) failures.push('raw_notice_leak_risk');
  if (row.code_unk) failures.push('code_unk');
  if (row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0) failures.push('no_customer_price');
  if (row.price_storage_mismatch) failures.push('price_storage_mismatch');
  if (row.customer_price_option_mismatch) failures.push('customer_price_option_mismatch');
  if (row.product_ledger_price_mismatch) failures.push('product_ledger_price_mismatch');
  if (row.price_tiers_mismatch) failures.push('price_tiers_mismatch');
  if (row.price_source_evidence_mismatch) {
    if (nonPublicSourceReview) warnings.push('needs_human_source_review');
    else failures.push('price_source_evidence_mismatch');
  }
  if (row.attraction_context_mismatch) failures.push('attraction_context_mismatch');
  if (row.attraction_unlinked_registered) failures.push('attraction_unlinked_registered');
  if (row.attraction_description_missing) failures.push('attraction_description_missing');
  if (row.itinerary_semantic_mismatch) failures.push('itinerary_semantic_mismatch');
  if (row.duration_trip_style_mismatch) failures.push('duration_trip_style_mismatch');
  if (row.hotel_field_semantic_mismatch) failures.push('hotel_field_semantic_mismatch');
  if (row.exclude_fragment_corruption) failures.push('exclude_fragment_corruption');
  if (row.optional_tour_surcharge_pollution) failures.push('optional_tour_surcharge_pollution');
  if (row.render_failure) failures.push('render_blocked');
  if (row.public_html_failure) failures.push('public_html_failure');
  if (row.itinerary_policy_leak) failures.push('itinerary_policy_leak');
  if (row.itinerary_days === 0) failures.push('no_itinerary_days');
  if (row.v3 === 'lookup_failed') failures.push('v3_lookup_failed');
  if (hardV3Blocked) {
    if (nonPublicSourceReview) addHumanReviewWarning();
    else failures.push('v3_blocked');
  }
  if (row.entity_attraction_unresolved > 0) {
    if (nonPublicSourceReview) addHumanReviewWarning();
    else failures.push('entity_attraction_unresolved');
  }
  if (row.entity_shopping_review_needed > 0) {
    if (nonPublicSourceReview) addHumanReviewWarning();
    else failures.push('entity_shopping_review_needed');
  }
  if (row.entity_option_review_needed > 0) {
    if (nonPublicSourceReview) addHumanReviewWarning();
    else failures.push('entity_option_review_needed');
  }
  if (row.entity_unknown_customer_visible > 0) {
    if (nonPublicSourceReview) addHumanReviewWarning();
    else failures.push('entity_unknown_customer_visible');
  }
  if (row.v3 === 'needs_review') {
    if (nonPublicSourceReview) addHumanReviewWarning();
    else warnings.push('v3_needs_review');
  }
  if (row.v3 === 'blocked' && !hardV3Blocked) warnings.push('v3_blocked_nonblocking');
  if (row.public && row.standard_notices === 0 && row.structured_facts === 0) warnings.push('public_without_v3_facts');
  if (row.unmatched_activities > 0) warnings.push('unmatched_activities_pending');

  return {
    status: failures.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    failures,
    warnings,
  };
}

let packageQuery = supabase
  .from('travel_packages')
  .select('id, title, short_code, internal_code, status, audit_status, audit_report, created_at, price, destination, duration, nights, trip_style, price_dates, price_tiers, itinerary, itinerary_data, raw_text, notices_parsed, customer_notes, inclusions, excludes, optional_tours')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(limit);

if (codeFilter.length > 0) {
  packageQuery = packageQuery.in('internal_code', codeFilter);
}
if (packageIdFilter.length > 0) {
  packageQuery = packageQuery.in('id', packageIdFilter);
}

const { data: packages, error } = await runSupabaseQuery('travel_packages', () => packageQuery);

if (error) {
  const message = error.message ?? String(error);
  const payload = {
    status: 'blocked',
    reason: 'TRAVEL_PACKAGES_QUERY_FAILED',
    message,
    days,
    limit,
    public_only: publicOnly,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(strict ? 1 : 0);
}

const allPackageRows = packages ?? [];
const scopedPackageRows = allPackageRows
  .filter(pkg => includeArchived || !isArchivedStatus(pkg.status))
  .filter(pkg => !publicOnly || isPublicStatus(pkg.status));
const scopedPackageIds = new Set(scopedPackageRows.map(pkg => pkg.id));
const packageIds = allPackageRows.map(pkg => pkg.id);
const internalCodes = allPackageRows.map(pkg => pkg.internal_code).filter(code => typeof code === 'string' && code.length > 0);
const auditDataErrors = [];
const attractionIds = new Set();
for (const pkg of allPackageRows) {
  const days = Array.isArray(pkg.itinerary_data?.days) ? pkg.itinerary_data.days : [];
  for (const day of days) {
    const schedule = Array.isArray(day?.schedule) ? day.schedule : [];
    for (const item of schedule) {
      const ids = Array.isArray(item?.attraction_ids) ? item.attraction_ids : [];
      for (const id of ids) if (typeof id === 'string' && id) attractionIds.add(id);
    }
  }
}
const attractionById = new Map();
if (attractionIds.size > 0) {
  for (const chunk of chunks(Array.from(attractionIds), 25)) {
    const { data: attractionRows, error: attractionError } = await runSupabaseQuery(
      `attractions by id ${chunk[0]}`,
      () => supabase
        .from('attractions')
        .select('id,name,region,country,short_desc,long_desc,customer_publishable')
        .in('id', chunk),
    );
    if (attractionError) {
      auditDataErrors.push({
        scope: 'attractions_by_id',
        attraction_ids: chunk,
        message: attractionError.message ?? String(attractionError),
      });
      continue;
    }
    for (const row of attractionRows ?? []) attractionById.set(String(row.id), row);
  }
}
const activeAttractionTerms = [];
for (let from = 0; ; from += 1000) {
  const { data: activeRows, error: activeAttractionError } = await runSupabaseQuery(
    `active attractions ${from}`,
    () => supabase
      .from('attractions')
      .select('id,name,aliases,region,country,category')
      .eq('is_active', true)
      .range(from, from + 999),
  );
  if (activeAttractionError) {
    auditDataErrors.push({ scope: 'active_attractions', message: activeAttractionError.message ?? String(activeAttractionError) });
    break;
  }
  for (const attraction of activeRows ?? []) {
    if (!isMatchableAttractionRow(attraction)) continue;
    for (const term of [attraction.name, ...(Array.isArray(attraction.aliases) ? attraction.aliases : [])]) {
      const clean = String(term ?? '').trim();
      if (clean !== attraction.name && isUnsafeRegisteredAttractionAlias(clean, attraction)) continue;
      if (isBadRegisteredAttractionTermV2(clean)) continue;
      if (normalizeTerm(clean).length >= 3 && clean.length <= 24) {
        activeAttractionTerms.push({ term: clean, attraction });
      }
    }
  }
  if (!activeRows || activeRows.length < 1000) break;
}
activeAttractionTerms.sort((a, b) => normalizeTerm(b.term).length - normalizeTerm(a.term).length);
const draftMap = new Map();
const priceCountMap = new Map();
const productPriceRowsByCode = new Map();
const productRowsByCode = new Map();
const unmatchedCountMap = new Map();
const unmatchedEntityMap = new Map();
const priceRowsLookupFailedCodes = new Set();
const draftLookupFailedPackageIds = new Set();
let unmatchedScopeReady = false;
let unmatchedScopeError = null;

{
  const { error: scopeError } = await runSupabaseQuery(
    'unmatched scope',
    () => supabase
      .from('unmatched_activities')
      .select('unmatched_scope_key')
      .limit(1),
  );
  unmatchedScopeReady = !scopeError;
  unmatchedScopeError = scopeError?.message ?? null;
}

if (packageIds.length > 0) {
  for (const chunk of chunks(packageIds, 25)) {
    const { data: drafts, error: draftError } = await runSupabaseQuery(
      `Draft rows ${chunk[0]}`,
      () => supabase
        .from('product_registration_drafts')
        .select('id, package_id, status, gate_result, ledger, match_summary, created_at')
        .in('package_id', chunk)
        .order('created_at', { ascending: false }),
    );
    if (draftError) {
      const message = draftError.message ?? String(draftError);
      for (const packageId of chunk) draftLookupFailedPackageIds.add(packageId);
      auditDataErrors.push({ scope: 'product_registration_drafts', package_ids: chunk, message });
      continue;
    }
    for (const draft of drafts ?? []) {
      if (!draftMap.has(draft.package_id)) draftMap.set(draft.package_id, draft);
    }
  }

  if (internalCodes.length > 0) {
    const priceLookup = await fetchProductPricesByCodes(internalCodes);
    for (const [code, rows] of priceLookup.rowsByCode.entries()) {
      productPriceRowsByCode.set(code, rows);
    }
    for (const [code, count] of priceLookup.countsByCode.entries()) {
      priceCountMap.set(code, count);
    }
    if (priceLookup.errors.length > 0) {
      for (const item of priceLookup.errors) {
        priceRowsLookupFailedCodes.add(item.code);
        auditDataErrors.push({ scope: 'product_prices', code: item.code, message: item.message });
      }
    }

    const { data: productRows, error: productError } = await runSupabaseQuery(
      'products by internal_code',
      () => supabase
        .from('products')
        .select('internal_code, net_price, selling_price, margin_rate')
        .in('internal_code', internalCodes),
    );
    if (!productError) {
      for (const product of productRows ?? []) {
        if (product.internal_code) productRowsByCode.set(product.internal_code, product);
      }
    }
  }

  for (const chunk of chunks(packageIds, 25)) {
    const { data: unmatchedRows, error: unmatchedError } = await runSupabaseQuery(
      `unmatched activities ${chunk[0]}`,
      () => supabase
        .from('unmatched_activities')
        .select('package_id, segment_kind_guess, suggested_action')
        .in('package_id', chunk)
        .eq('status', 'pending')
        .is('resolved_attraction_id', null),
    );
    if (!unmatchedError) {
      for (const item of unmatchedRows ?? []) {
        unmatchedCountMap.set(item.package_id, (unmatchedCountMap.get(item.package_id) ?? 0) + 1);
        const current = unmatchedEntityMap.get(item.package_id) ?? {
          attraction_unresolved: 0,
          shopping_review_needed: 0,
          option_review_needed: 0,
          unknown_customer_visible: 0,
        };
        const kind = item.segment_kind_guess ?? 'attraction';
        if (kind === 'attraction') current.attraction_unresolved++;
        if (kind === 'shopping') current.shopping_review_needed++;
        if (kind === 'optional_tour') current.option_review_needed++;
        if (kind === 'unknown') current.unknown_customer_visible++;
        unmatchedEntityMap.set(item.package_id, current);
      }
    }
  }
}

const priceStorageRepairs = [];
if (repairPriceStorage) {
  for (const pkg of scopedPackageRows) {
    if (!pkg.internal_code) continue;
    const replacementRows = normalizedPriceDates(pkg);
    if (replacementRows.length === 0) continue;
    const mismatch = priceStorageMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []);
    if (!mismatch) continue;

    try {
      await replaceProductPricesForProduct(pkg.internal_code, replacementRows);
    } catch (error) {
      priceStorageRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    productPriceRowsByCode.set(pkg.internal_code, replacementRows);
    priceCountMap.set(pkg.internal_code, replacementRows.length);
    const replacementPriceDates = validPackagePriceDates(pkg);
    const minPrice = minimumPackagePrice(replacementPriceDates);
    const nextPriceTiers = priceTiersFromPackagePriceDates(replacementPriceDates);
    const now = new Date().toISOString();
    const packagePatch = {
      ...(minPrice != null ? { price: minPrice } : {}),
      ...(nextPriceTiers.length > 0 ? { price_tiers: nextPriceTiers } : {}),
      updated_at: now,
    };
    const { error: packageUpdateError } = await supabase
      .from('travel_packages')
      .update(packagePatch)
      .eq('id', pkg.id);
    if (packageUpdateError) {
      priceStorageRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        reason: packageUpdateError.message,
      });
      continue;
    }
    if (minPrice != null) {
      const { error: productUpdateError } = await supabase
        .from('products')
        .update({ net_price: minPrice, updated_at: now })
        .eq('internal_code', pkg.internal_code);
      if (productUpdateError) {
        priceStorageRepairs.push({
          code: pkg.internal_code,
          title: pkg.title,
          ok: false,
          reason: productUpdateError.message,
        });
        continue;
      }
    }
    priceStorageRepairs.push({
      code: pkg.internal_code,
      title: pkg.title,
      ok: true,
      before: mismatch,
      rows: replacementRows.length,
      min_price: minPrice,
    });
  }
}

const priceSourceEvidenceRepairs = [];
async function persistPriceSourceNeedsHumanReview(pkg, mismatch, pruned, checkedAt) {
  const currentReport = pkg.audit_report && typeof pkg.audit_report === 'object' && !Array.isArray(pkg.audit_report)
    ? pkg.audit_report
    : {};
  const currentAutopilot = currentReport.upload_to_open_autopilot
    && typeof currentReport.upload_to_open_autopilot === 'object'
    && !Array.isArray(currentReport.upload_to_open_autopilot)
    ? currentReport.upload_to_open_autopilot
    : {};
  const nextAuditReport = {
    ...currentReport,
    upload_to_open_autopilot: {
      ...currentAutopilot,
      final_state: 'needs_human_source_review',
      status: 'needs_human_source_review',
      reason: 'price_source_evidence_missing',
      blocker: mismatch,
      repair_attempted: true,
      applied_repairs: [
        ...new Set([
          ...(Array.isArray(currentAutopilot.applied_repairs) ? currentAutopilot.applied_repairs : []),
          'price_source_evidence_prune_attempted',
        ]),
      ],
      unresolved_reasons: [
        ...new Set([
          ...(Array.isArray(currentAutopilot.unresolved_reasons) ? currentAutopilot.unresolved_reasons : []),
          pruned?.reason ?? mismatch,
        ].filter(Boolean)),
      ],
      removed_candidates: pruned?.removed ?? [],
      next_action: 'Attach supplier source text that contains the price/date table, then rerun mobile readiness repair.',
      checked_at: checkedAt,
      version: 'mobile-readiness-source-review-v1',
    },
  };

  const { error } = await supabase
    .from('travel_packages')
    .update({
      audit_status: 'needs_review',
      audit_checked_at: checkedAt,
      audit_report: nextAuditReport,
      updated_at: checkedAt,
    })
    .eq('id', pkg.id);
  if (error) return { ok: false, reason: error.message };

  pkg.audit_status = 'needs_review';
  pkg.audit_checked_at = checkedAt;
  pkg.audit_report = nextAuditReport;
  return { ok: true, audit_report: nextAuditReport };
}

if (repairPriceSourceEvidence) {
  const checkedAt = new Date().toISOString();
  for (const pkg of scopedPackageRows) {
    if (!pkg.id || !pkg.internal_code) continue;
    const currentPriceRows = productPriceRowsByCode.get(pkg.internal_code) ?? [];
    const mismatch = priceDateSourceEvidenceMismatch(pkg, currentPriceRows);
    if (!mismatch) continue;

    const pruned = pruneUnsupportedPriceDates(pkg, currentPriceRows);
    if (!pruned || pruned.removed.length === 0) continue;
    if (!pruned.ok || pruned.price_dates.length === 0) {
      const review = await persistPriceSourceNeedsHumanReview(pkg, mismatch, pruned, checkedAt);
      priceSourceEvidenceRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        before: mismatch,
        removed: pruned.removed,
        reason: pruned?.reason ?? 'unable_to_prune_source_evidence',
        final_state: 'needs_human_source_review',
        review_state_persisted: review.ok,
        ...(review.ok ? {} : { review_state_error: review.reason }),
      });
      continue;
    }

    const minPrice = minimumPackagePrice(pruned.price_dates);
    const nextPriceTiers = priceTiersFromPackagePriceDates(pruned.price_dates);
    if (minPrice == null || nextPriceTiers.length === 0) {
      priceSourceEvidenceRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        before: mismatch,
        removed: pruned.removed,
        reason: 'price_dates_pruned_to_invalid_price_store',
      });
      continue;
    }

    const replacementPackage = {
      ...pkg,
      price_dates: pruned.price_dates,
      price_tiers: nextPriceTiers,
      price: minPrice,
    };
    const supportedDates = new Set(pruned.price_dates.map(row => row.date));
    const preservedRows = currentPriceRows
      .filter(row => row?.target_date && supportedDates.has(row.target_date))
      .map(row => ({
        product_id: pkg.internal_code,
        target_date: row.target_date,
        day_of_week: null,
        net_price: Number(row.net_price),
        adult_selling_price: Number(row.adult_selling_price ?? row.net_price),
        child_price: null,
        note: row.note ?? null,
      }))
      .filter(row => Number.isFinite(row.net_price) && row.net_price > 0);
    const replacementRows = preservedRows.length > 0 ? preservedRows : normalizedPriceDates(replacementPackage);
    try {
      await replaceProductPricesForProduct(pkg.internal_code, replacementRows);
    } catch (error) {
      priceSourceEvidenceRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        before: mismatch,
        removed: pruned.removed,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        price: minPrice,
        price_dates: pruned.price_dates,
        price_tiers: nextPriceTiers,
        updated_at: checkedAt,
      })
      .eq('id', pkg.id);
    if (packageError) {
      priceSourceEvidenceRepairs.push({
        code: pkg.internal_code,
        title: pkg.title,
        ok: false,
        before: mismatch,
        removed: pruned.removed,
        reason: packageError.message,
      });
      continue;
    }

    let productLedgerSynced = false;
    let productLedgerSyncError = null;
    const { error: productError } = await supabase
      .from('products')
      .update({
        net_price: minPrice,
        updated_at: checkedAt,
      })
      .eq('internal_code', pkg.internal_code);
    productLedgerSynced = !productError;
    productLedgerSyncError = productError?.message ?? null;
    if (!productError) {
      const currentProduct = productRowsByCode.get(pkg.internal_code) ?? {};
      productRowsByCode.set(pkg.internal_code, {
        ...currentProduct,
        internal_code: pkg.internal_code,
        net_price: minPrice,
      });
    }

    pkg.price = minPrice;
    pkg.price_dates = pruned.price_dates;
    pkg.price_tiers = nextPriceTiers;
    productPriceRowsByCode.set(pkg.internal_code, replacementRows);
    priceCountMap.set(pkg.internal_code, replacementRows.length);
    priceSourceEvidenceRepairs.push({
      code: pkg.internal_code,
      title: pkg.title,
      ok: productLedgerSyncError == null,
      before: mismatch,
      removed: pruned.removed,
      remaining_price_dates: pruned.price_dates.length,
      product_ledger_synced: productLedgerSynced,
      ...(productLedgerSyncError ? { reason: productLedgerSyncError } : {}),
    });
  }
}

const priceTierRepairs = [];
if (repairPriceTiers) {
  const checkedAt = new Date().toISOString();
  for (const pkg of scopedPackageRows) {
    if (!pkg.id) continue;
    const mismatch = priceTiersMismatch(pkg);
    if (!mismatch) continue;

    const priceDates = validPackagePriceDates(pkg);
    const minPrice = minimumPackagePrice(priceDates);
    if (priceDates.length === 0 || minPrice == null) {
      priceTierRepairs.push({
        code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
        title: pkg.title,
        ok: false,
        reason: 'price_dates_missing_or_invalid',
      });
      continue;
    }

    if (pkg.internal_code) {
      const storageMismatch = priceStorageMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []);
      if (storageMismatch) {
        priceTierRepairs.push({
          code: pkg.internal_code,
          title: pkg.title,
          ok: false,
          reason: `price_storage_mismatch_remaining: ${storageMismatch}`,
        });
        continue;
      }
    }

    const nextPriceTiers = priceTiersFromPackagePriceDates(priceDates);
    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        price: minPrice,
        price_tiers: nextPriceTiers,
        updated_at: checkedAt,
      })
      .eq('id', pkg.id);
    if (packageError) {
      priceTierRepairs.push({
        code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
        title: pkg.title,
        ok: false,
        reason: packageError.message,
      });
      continue;
    }

    let productLedgerSynced = false;
    let productLedgerSyncError = null;
    if (pkg.internal_code) {
      const { error: productError } = await supabase
        .from('products')
        .update({
          net_price: minPrice,
          updated_at: checkedAt,
        })
        .eq('internal_code', pkg.internal_code);
      productLedgerSynced = !productError;
      productLedgerSyncError = productError?.message ?? null;
      if (!productError) {
        const currentProduct = productRowsByCode.get(pkg.internal_code) ?? {};
        productRowsByCode.set(pkg.internal_code, {
          ...currentProduct,
          internal_code: pkg.internal_code,
          net_price: minPrice,
        });
      }
    }

    pkg.price = minPrice;
    pkg.price_tiers = nextPriceTiers;
    priceTierRepairs.push({
      code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
      title: pkg.title,
      ok: productLedgerSyncError == null,
      before: mismatch,
      rows: nextPriceTiers.length,
      min_price: minPrice,
      product_ledger_synced: productLedgerSynced,
      ...(productLedgerSyncError ? { reason: productLedgerSyncError } : {}),
    });
  }
}

const itineraryDisplayRepairs = [];
if (repairItineraryDisplay) {
  const checkedAt = new Date().toISOString();
  for (const pkg of scopedPackageRows) {
    if (!pkg.id) continue;
    const repaired = repairItineraryDisplayQuality(pkg);
    if (!repaired) continue;

    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        itinerary_data: repaired.itinerary_data,
        updated_at: checkedAt,
      })
      .eq('id', pkg.id);
    if (packageError) {
      itineraryDisplayRepairs.push({
        code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
        title: pkg.title,
        ok: false,
        reason: packageError.message,
        removed: repaired.removed,
      });
      continue;
    }

    pkg.itinerary_data = repaired.itinerary_data;
    itineraryDisplayRepairs.push({
      code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
      title: pkg.title,
      ok: true,
      removed: repaired.removed,
    });
  }
}

const emptyItineraryDayRepairs = [];
if (repairEmptyItineraryDays) {
  const checkedAt = new Date().toISOString();
  for (const pkg of scopedPackageRows) {
    if (!pkg.id) continue;
    const repaired = repairEmptyItineraryDaysQuality(pkg);
    if (!repaired) continue;

    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        itinerary_data: repaired.itinerary_data,
        updated_at: checkedAt,
      })
      .eq('id', pkg.id);
    if (packageError) {
      emptyItineraryDayRepairs.push({
        code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
        title: pkg.title,
        ok: false,
        reason: packageError.message,
        filled: repaired.filled,
      });
      continue;
    }

    pkg.itinerary_data = repaired.itinerary_data;
    emptyItineraryDayRepairs.push({
      code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
      title: pkg.title,
      ok: true,
      filled: repaired.filled,
    });
  }
}

const excludeFragmentRepairs = [];
if (repairExcludeFragments) {
  const checkedAt = new Date().toISOString();
  for (const pkg of scopedPackageRows) {
    if (!pkg.id) continue;
    const repaired = repairExcludeFragmentList(pkg.excludes);
    if (!repaired) continue;

    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        excludes: repaired.excludes,
        updated_at: checkedAt,
      })
      .eq('id', pkg.id);
    if (packageError) {
      excludeFragmentRepairs.push({
        code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
        title: pkg.title,
        ok: false,
        reason: packageError.message,
        removed: repaired.removed,
      });
      continue;
    }

    pkg.excludes = repaired.excludes;
    excludeFragmentRepairs.push({
      code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
      title: pkg.title,
      ok: true,
      removed: repaired.removed,
      excludes: repaired.excludes,
    });
  }
}

const durationTripStyleRepairs = [];
if (repairDurationTripStyle) {
  const checkedAt = new Date().toISOString();
  for (const pkg of scopedPackageRows) {
    if (!pkg.id) continue;
    const repaired = repairDurationTripStyleValues(pkg);
    if (!repaired) continue;

    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        ...repaired.patch,
        updated_at: checkedAt,
      })
      .eq('id', pkg.id);
    if (packageError) {
      durationTripStyleRepairs.push({
        code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
        title: pkg.title,
        ok: false,
        reason: packageError.message,
        before: repaired.before,
        after: repaired.after,
      });
      continue;
    }

    Object.assign(pkg, repaired.patch);
    durationTripStyleRepairs.push({
      code: pkg.internal_code ?? pkg.short_code ?? pkg.id,
      title: pkg.title,
      ok: true,
      before: repaired.before,
      after: repaired.after,
    });
  }
}

let rows = allPackageRows
  .filter(pkg => scopedPackageIds.has(pkg.id))
  .map(pkg => {
    const draft = draftMap.get(pkg.id);
    const draftLookupFailed = draftLookupFailedPackageIds.has(pkg.id);
    const draftEntities = draftEntitySummary(draft);
    const queueEntities = unmatchedEntityMap.get(pkg.id) ?? {};
    const priceRowsLookupFailed = priceRowsLookupFailedCodes.has(pkg.internal_code);
    const row = {
      id: pkg.id,
      code: pkg.internal_code ?? pkg.short_code ?? '',
      title: pkg.title,
      status: pkg.status,
      public: isPublicStatus(pkg.status),
      audit: pkg.audit_status ?? '',
      audit_report: pkg.audit_report ?? null,
      created_at: pkg.created_at,
      v3: gateStatus(draft, draftLookupFailed),
      draft_id: draft?.id ?? null,
      draft_lookup_failed: draftLookupFailed,
      price_dates: Array.isArray(pkg.price_dates) ? pkg.price_dates.length : 0,
      price_tiers: Array.isArray(pkg.price_tiers) ? pkg.price_tiers.length : 0,
      product_prices: priceRowsLookupFailed ? null : priceCountMap.get(pkg.internal_code) ?? 0,
      itinerary_days: countItineraryDays(pkg),
      standard_notices: countLedgerRows(draft, 'standard_notices'),
      structured_facts: countLedgerRows(draft, 'structured_facts'),
      unmatched_activities: unmatchedCountMap.get(pkg.id) ?? draftAttractionUnmatchedCount(draft) ?? 0,
      // The live unmatched queue is the canonical customer-open blocker after
      // deterministic repairs. Older V3 drafts can keep stale review counts after the
      // queue has already resolved rows, so use the current pending queue for blockers.
      entity_attraction_unresolved: queueEntities.attraction_unresolved || 0,
      // Shopping visits and optional tours are customer-visible structured facts, not
      // attraction masters. Keep them on the same live-queue source.
      entity_shopping_review_needed: queueEntities.shopping_review_needed || 0,
      entity_option_review_needed: queueEntities.option_review_needed || 0,
      entity_unknown_customer_visible: draft && !draftLookupFailed ? draftEntities.unknown_customer_visible : queueEntities.unknown_customer_visible || 0,
      entity_noise_removed: draftEntities.noise_removed,
      entity_meal_structured: draftEntities.meal_structured,
      entity_transfer_structured: draftEntities.transfer_structured,
      code_unk: hasUnresolvedCodeOrDestination(pkg),
      raw_notice_leak_risk: hasRawLeakRisk(pkg),
      price_lookup_failed: priceRowsLookupFailed,
      price_storage_mismatch: priceRowsLookupFailed ? false : priceStorageMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []),
      customer_price_option_mismatch: priceRowsLookupFailed ? false : customerPriceOptionMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []),
      product_ledger_price_mismatch: productLedgerPriceMismatch(pkg, productRowsByCode.get(pkg.internal_code)),
      price_tiers_mismatch: priceTiersMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []),
      price_source_evidence_mismatch: priceDateSourceEvidenceMismatch(pkg, productPriceRowsByCode.get(pkg.internal_code) ?? []),
      attraction_context_mismatch: attractionContextMismatch(pkg, attractionById),
      attraction_unlinked_registered: unlinkedRegisteredAttractionTerm(pkg, activeAttractionTerms),
      attraction_description_missing: attractionDescriptionMissing(pkg, attractionById),
      itinerary_semantic_mismatch: itinerarySemanticMismatch(pkg),
      duration_trip_style_mismatch: durationTripStyleMismatch(pkg),
      hotel_field_semantic_mismatch: hotelFieldSemanticMismatch(pkg),
      exclude_fragment_corruption: excludeFragmentCorruption(pkg),
      optional_tour_surcharge_pollution: optionalTourSurchargePollution(pkg),
      itinerary_policy_leak: hasItineraryPolicyLeak(pkg),
      render_failure: renderFailure(pkg),
    };
    return { ...row, readiness: readinessFor(row), trust_score: trustScore(row) };
  });

if (verifyPublicHtml) {
  const verifiedRows = [];
  for (const row of rows) {
    const publicHtmlFailure = await verifyPublicHtmlSurface(row);
    const nextRow = { ...row, public_html_failure: publicHtmlFailure };
    verifiedRows.push({ ...nextRow, readiness: readinessFor(nextRow), trust_score: trustScore(nextRow) });
  }
  rows = verifiedRows;
}

const publicRows = rows.filter(row => row.public);
const failedRows = rows.filter(row => row.readiness.status === 'fail');
const warnedRows = rows.filter(row => row.readiness.status === 'warn');
const demotionCandidates = rows.filter(row =>
  row.public
  && row.readiness.status === 'fail'
  && !row.draft_lookup_failed
  && !row.price_lookup_failed
);
const demotions = [];
const archiveCandidates = rows.filter(row =>
  archiveFailedNonPublic
  && !row.public
  && row.readiness.status === 'fail'
  && !isArchivedStatus(row.status)
  && !row.draft_lookup_failed
  && !row.price_lookup_failed
);
const archives = [];

if (demoteUnsafePublic) {
  const checkedAt = new Date().toISOString();
  for (const row of demotionCandidates) {
    const auditReport = {
      source: 'mobile-landing-readiness-demotion',
      checked_at: checkedAt,
      previous_status: row.status,
      readiness: row.readiness,
      trust_score: row.trust_score,
      v3_status: row.v3,
      draft_id: row.draft_id,
      entity_counts: {
        attraction_unresolved: row.entity_attraction_unresolved,
        shopping_review_needed: row.entity_shopping_review_needed,
        option_review_needed: row.entity_option_review_needed,
        unknown_customer_visible: row.entity_unknown_customer_visible,
      },
      price_storage_mismatch: row.price_storage_mismatch,
      customer_price_option_mismatch: row.customer_price_option_mismatch,
      product_ledger_price_mismatch: row.product_ledger_price_mismatch,
      price_tiers_mismatch: row.price_tiers_mismatch,
      render_failure: row.render_failure,
      public_html_failure: row.public_html_failure,
    };
    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        status: 'pending_review',
        audit_status: 'blocked',
        audit_checked_at: checkedAt,
        audit_report: auditReport,
        updated_at: checkedAt,
      })
      .eq('id', row.id);
    if (packageError) {
      demotions.push({ id: row.id, code: row.code, title: row.title, ok: false, reason: packageError.message });
      continue;
    }

    let productStatusUpdated = false;
    if (row.code) {
      const { error: productError } = await supabase
        .from('products')
        .update({ status: 'pending_review', updated_at: checkedAt })
        .eq('internal_code', row.code);
      productStatusUpdated = !productError;
    }
    demotions.push({
      id: row.id,
      code: row.code,
      title: row.title,
      ok: true,
      previous_status: row.status,
      new_status: 'pending_review',
      product_status_updated: productStatusUpdated,
      failures: row.readiness.failures,
    });
  }
}

if (archiveFailedNonPublic) {
  const checkedAt = new Date().toISOString();
  for (const row of archiveCandidates) {
    const auditReport = {
      source: 'mobile-landing-readiness-nonpublic-archive',
      checked_at: checkedAt,
      previous_status: row.status,
      readiness: row.readiness,
      trust_score: row.trust_score,
      v3_status: row.v3,
      draft_id: row.draft_id,
      entity_counts: {
        attraction_unresolved: row.entity_attraction_unresolved,
        shopping_review_needed: row.entity_shopping_review_needed,
        option_review_needed: row.entity_option_review_needed,
        unknown_customer_visible: row.entity_unknown_customer_visible,
      },
      price_storage_mismatch: row.price_storage_mismatch,
      customer_price_option_mismatch: row.customer_price_option_mismatch,
      product_ledger_price_mismatch: row.product_ledger_price_mismatch,
      price_tiers_mismatch: row.price_tiers_mismatch,
      render_failure: row.render_failure,
    };
    const { error: packageError } = await supabase
      .from('travel_packages')
      .update({
        status: 'archived',
        audit_status: 'blocked',
        audit_checked_at: checkedAt,
        audit_report: auditReport,
        updated_at: checkedAt,
      })
      .eq('id', row.id);
    if (packageError) {
      archives.push({ id: row.id, code: row.code, title: row.title, ok: false, reason: packageError.message });
      continue;
    }

    let productStatusUpdated = false;
    if (row.code) {
      const { error: productError } = await supabase
        .from('products')
        .update({ status: 'archived', updated_at: checkedAt })
        .eq('internal_code', row.code);
      productStatusUpdated = !productError;
    }
    archives.push({
      id: row.id,
      code: row.code,
      title: row.title,
      ok: true,
      previous_status: row.status,
      new_status: 'archived',
      product_status_updated: productStatusUpdated,
      failures: row.readiness.failures,
    });
  }
}

const blockingAuditDataErrors = auditDataErrors.filter(error => !['attractions_by_id'].includes(String(error.scope ?? '')));
const summary = {
  since,
  days,
  limit,
  include_archived: includeArchived,
  public_only: publicOnly,
  total: rows.length,
  public_total: publicRows.length,
  pass: rows.filter(row => row.readiness.status === 'pass').length,
  warn: warnedRows.length,
  fail: failedRows.length,
  public_fail: publicRows.filter(row => row.readiness.status === 'fail').length,
  raw_notice_leak_risk: rows.filter(row => row.raw_notice_leak_risk).length,
  code_unk: rows.filter(row => row.code_unk).length,
  no_customer_price: rows.filter(row => row.price_dates === 0 && row.price_tiers === 0 && row.product_prices === 0).length,
  price_storage_mismatch: rows.filter(row => row.price_storage_mismatch).length,
  customer_price_option_mismatch: rows.filter(row => row.customer_price_option_mismatch).length,
  product_ledger_price_mismatch: rows.filter(row => row.product_ledger_price_mismatch).length,
  price_tiers_mismatch: rows.filter(row => row.price_tiers_mismatch).length,
  price_source_evidence_mismatch: rows.filter(row =>
    row.readiness.failures.includes('price_source_evidence_mismatch')).length,
  needs_human_source_review: rows.filter(row =>
    row.readiness.warnings.includes('needs_human_source_review')).length,
  attraction_context_mismatch: rows.filter(row => row.attraction_context_mismatch).length,
  attraction_unlinked_registered: rows.filter(row => row.attraction_unlinked_registered).length,
  attraction_description_missing: rows.filter(row => row.attraction_description_missing).length,
  itinerary_semantic_mismatch: rows.filter(row => row.itinerary_semantic_mismatch).length,
  render_blocked: rows.filter(row => row.render_failure).length,
  public_html_failure: rows.filter(row => row.public_html_failure).length,
  itinerary_policy_leak: rows.filter(row => row.itinerary_policy_leak).length,
  no_itinerary_days: rows.filter(row => row.itinerary_days === 0).length,
  v3_lookup_failed: rows.filter(row => row.v3 === 'lookup_failed').length,
  v3_blocked: rows.filter(row => row.readiness.failures.includes('v3_blocked')).length,
  v3_needs_review: rows.filter(row => row.v3 === 'needs_review').length,
  v3_needs_review_blocking: rows.filter(row => isBlockingV3NeedsReview(row)).length,
  missing_v3_draft: rows.filter(row => row.v3 === 'none').length,
  unmatched_activity_packages: rows.filter(row => row.unmatched_activities > 0).length,
  entity_attraction_unresolved_packages: rows.filter(row => row.entity_attraction_unresolved > 0).length,
  entity_shopping_review_packages: rows.filter(row => row.entity_shopping_review_needed > 0).length,
  entity_option_review_packages: rows.filter(row => row.entity_option_review_needed > 0).length,
  entity_unknown_customer_visible_packages: rows.filter(row => row.entity_unknown_customer_visible > 0).length,
  entity_noise_removed_packages: rows.filter(row => row.entity_noise_removed > 0).length,
  entity_meal_structured_packages: rows.filter(row => row.entity_meal_structured > 0).length,
  entity_transfer_structured_packages: rows.filter(row => row.entity_transfer_structured > 0).length,
  unmatched_queue_scope_ready: unmatchedScopeReady,
  unmatched_queue_scope_error: unmatchedScopeError,
  schema_failures: unmatchedScopeReady ? 0 : 1,
  data_query_failures: blockingAuditDataErrors.length,
  nonblocking_data_query_failures: auditDataErrors.length - blockingAuditDataErrors.length,
  repaired_price_storage: priceStorageRepairs.filter(repair => repair.ok).length,
  repaired_price_source_evidence: priceSourceEvidenceRepairs.filter(repair => repair.ok).length,
  repaired_price_tiers: priceTierRepairs.filter(repair => repair.ok).length,
  repaired_itinerary_display: itineraryDisplayRepairs.filter(repair => repair.ok).length,
  repaired_empty_itinerary_days: emptyItineraryDayRepairs.filter(repair => repair.ok).length,
  repaired_exclude_fragments: excludeFragmentRepairs.filter(repair => repair.ok).length,
  repaired_duration_trip_style: durationTripStyleRepairs.filter(repair => repair.ok).length,
  demote_unsafe_public: demoteUnsafePublic,
  demotion_candidates: demotionCandidates.length,
  demoted_public: demotions.filter(row => row.ok).length,
  archive_failed_nonpublic: archiveFailedNonPublic,
  archive_failed_nonpublic_candidates: archiveCandidates.length,
  archived_nonpublic: archives.filter(row => row.ok).length,
};

const report = {
  summary,
  schema: {
    unmatched_queue_scope_ready: unmatchedScopeReady,
    unmatched_queue_scope_error: unmatchedScopeError,
    required_migration: unmatchedScopeReady ? null : 'supabase/migrations/20260605001000_unmatched_activities_package_scope.sql',
  },
  data_query_errors: auditDataErrors,
  repairs: [
    ...priceStorageRepairs,
    ...priceSourceEvidenceRepairs.map(repair => ({ ...repair, type: 'price_source_evidence' })),
    ...priceTierRepairs.map(repair => ({ ...repair, type: 'price_tiers' })),
    ...itineraryDisplayRepairs.map(repair => ({ ...repair, type: 'itinerary_display' })),
    ...emptyItineraryDayRepairs.map(repair => ({ ...repair, type: 'empty_itinerary_days' })),
    ...excludeFragmentRepairs.map(repair => ({ ...repair, type: 'exclude_fragments' })),
    ...durationTripStyleRepairs.map(repair => ({ ...repair, type: 'duration_trip_style' })),
  ],
  demotions,
  archives,
  failed: failedRows.map(row => ({
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    failures: row.readiness.failures,
    warnings: row.readiness.warnings,
    price_storage_mismatch: row.price_storage_mismatch,
    customer_price_option_mismatch: row.customer_price_option_mismatch,
    product_ledger_price_mismatch: row.product_ledger_price_mismatch,
    price_tiers_mismatch: row.price_tiers_mismatch,
    price_source_evidence_mismatch: row.price_source_evidence_mismatch,
    attraction_context_mismatch: row.attraction_context_mismatch,
    attraction_unlinked_registered: row.attraction_unlinked_registered,
    attraction_description_missing: row.attraction_description_missing,
    itinerary_semantic_mismatch: row.itinerary_semantic_mismatch,
    render_failure: row.render_failure,
    public_html_failure: row.public_html_failure,
  })),
  warnings: warnedRows.slice(0, 50).map(row => ({ id: row.id, code: row.code, title: row.title, status: row.status, warnings: row.readiness.warnings })),
  rows,
};

if (!jsonOnly) {
  console.table(rows.map(row => ({
    code: row.code,
    status: row.status,
    v3: row.v3,
    prices: row.price_dates || row.price_tiers || row.product_prices,
    code_ok: row.code_unk ? 'UNK' : 'ok',
    storage: row.price_storage_mismatch ? 'mismatch' : 'ok',
    options: row.customer_price_option_mismatch ? 'mismatch' : 'ok',
    product_ledger: row.product_ledger_price_mismatch ? 'mismatch' : 'ok',
    price_source: row.price_source_evidence_mismatch ? 'mismatch' : 'ok',
    attraction_ctx: row.attraction_context_mismatch ? 'mismatch' : row.attraction_description_missing ? 'desc_missing' : 'ok',
    itinerary_semantic: row.itinerary_semantic_mismatch ? 'mismatch' : 'ok',
    render: row.render_failure ? 'fail' : 'ok',
    public_html: row.public_html_failure ? 'fail' : 'ok',
    policy: row.itinerary_policy_leak ? 'leak' : 'ok',
    days: row.itinerary_days,
    facts: row.structured_facts,
    notices: row.standard_notices,
    trust: row.trust_score.score,
    unmatched: row.unmatched_activities,
    leak: row.raw_notice_leak_risk,
    readiness: row.readiness.status,
    title: row.title,
  })));
}

console.log(JSON.stringify(jsonOnly ? report : { summary, repairs: report.repairs, demotions: report.demotions, archives: report.archives, failed: report.failed, warnings: report.warnings }, null, 2));

if (strict) {
  const strictFailures = [];
  if (summary.schema_failures > 0) strictFailures.push('schema_failures');
  if (summary.data_query_failures > 0) strictFailures.push('data_query_failures');
  if (summary.fail > 0) strictFailures.push('readiness_fail');
  if (summary.public_fail > 0) strictFailures.push('public_fail');
  if (summary.raw_notice_leak_risk > 0) strictFailures.push('raw_notice_leak_risk');
  if (summary.code_unk > 0) strictFailures.push('code_unk');
  if (summary.no_customer_price > 0) strictFailures.push('no_customer_price');
  if (summary.price_storage_mismatch > 0) strictFailures.push('price_storage_mismatch');
  if (summary.customer_price_option_mismatch > 0) strictFailures.push('customer_price_option_mismatch');
  if (summary.product_ledger_price_mismatch > 0) strictFailures.push('product_ledger_price_mismatch');
  if (summary.price_tiers_mismatch > 0) strictFailures.push('price_tiers_mismatch');
  if (summary.price_source_evidence_mismatch > 0) strictFailures.push('price_source_evidence_mismatch');
  if (summary.attraction_context_mismatch > 0) strictFailures.push('attraction_context_mismatch');
  if (summary.attraction_unlinked_registered > 0) strictFailures.push('attraction_unlinked_registered');
  if (summary.attraction_description_missing > 0) strictFailures.push('attraction_description_missing');
  if (summary.itinerary_semantic_mismatch > 0) strictFailures.push('itinerary_semantic_mismatch');
  if (summary.render_blocked > 0) strictFailures.push('render_blocked');
  if (summary.public_html_failure > 0) strictFailures.push('public_html_failure');
  if (summary.itinerary_policy_leak > 0) strictFailures.push('itinerary_policy_leak');
  if (summary.no_itinerary_days > 0) strictFailures.push('no_itinerary_days');
  if (summary.v3_lookup_failed > 0) strictFailures.push('v3_lookup_failed');
  if (summary.v3_blocked > 0) strictFailures.push('v3_blocked');
  if (summary.v3_needs_review_blocking > 0) strictFailures.push('v3_needs_review');
  if (summary.missing_v3_draft > 0) strictFailures.push('missing_v3_draft');
  if (strictFailures.length > 0) {
    console.error(`Strict product mobile readiness audit failed: ${strictFailures.join(', ')}`);
    process.exit(1);
  }
}
