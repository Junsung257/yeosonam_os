/**
 * MRT MCP 공통 (JSON-RPC) — sync_mrt_attractions / mrt_detail_worker 에서 공유
 */
const cheerio = require('cheerio');

const MCP_URL = 'https://mcp-servers.myrealtrip.com/mcp';
let _rpcId = 1;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitterDelay() {
  return sleep(500 + Math.random() * 1000);
}

/** 지수 백오프: 429 시 2→4→8초 */
async function fetchWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await jitterDelay();
      return await fn();
    } catch (e) {
      const is429 = e?.status === 429 || String(e?.message).includes('429');
      if (is429 && i < maxRetries - 1) {
        const wait = 2 ** (i + 1) * 1000;
        console.warn(`    [429] ${wait / 1000}초 대기 후 재시도`);
        await sleep(wait);
      } else {
        return null;
      }
    }
  }
  return null;
}

async function mcpCall(toolName, args, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: _rpcId++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error) return null;
    const text = json.result?.content?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** HTML → 순수 텍스트 (cheerio 정제, 2000자 제한) */
function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  $('br').replaceWith('\n');
  $('p, li, div').each((_, el) => $(el).append('\n'));
  return $('body')
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

async function fetchTnaDesc(gid, url) {
  return fetchWithBackoff(async () => {
    const detail = await mcpCall(
      'getTnaDetail',
      { gid: String(gid), url: String(url || '') },
      20000,
    );
    if (!detail) return null;
    const raw = detail.copy_text ?? '';
    return htmlToText(raw) || null;
  });
}

async function fetchStayDesc(gid) {
  return fetchWithBackoff(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const detail = await mcpCall(
      'getStayDetail',
      {
        gid: String(gid),
        checkIn: today,
        checkOut: tomorrow,
        adultCount: 2,
        childCount: 0,
      },
      20000,
    );
    if (!detail) return null;
    const raw = detail.copy_text ?? '';
    return htmlToText(raw) || null;
  });
}

/** getCategoryList 응답 → { category_ext_id, category_name, item_count }[] */
function normalizeCategoryList(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : raw.categories?.length
      ? raw.categories
      : raw.items ?? [];
  return list.map((r, idx) => ({
    category_ext_id: r.id != null ? String(r.id) : String(idx),
    category_name: String(r.label ?? r.name ?? '').trim(),
    item_count: typeof r.count === 'number' ? r.count : null,
  })).filter(x => x.category_name.length > 0);
}

async function fetchCategoryList(cityQuery) {
  const raw = await mcpCall('getCategoryList', { city: cityQuery }, 6000);
  return normalizeCategoryList(raw);
}

module.exports = {
  MCP_URL,
  sleep,
  jitterDelay,
  fetchWithBackoff,
  mcpCall,
  htmlToText,
  fetchTnaDesc,
  fetchStayDesc,
  fetchCategoryList,
  normalizeCategoryList,
};
