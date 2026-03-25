/**
 * ══════════════════════════════════════════════════════════════
 * 여소남 OS — 궁극의 데이터 레이크 적재 스크립트 v3.5
 * ══════════════════════════════════════════════════════════════
 *
 * 실행: node scripts/archive-loader.js
 *       node scripts/archive-loader.js --dry-run
 *
 * v3.5 아키텍처:
 *   1. Master-Child SKU (1 PDF → N 상품)
 *   2. price_history 가격 변동 영구 추적
 *   3. parsed_chunks Semantic Chunking (RAG 즉시 투입 가능)
 *   4. UPSERT 멱등성 (100번 실행해도 안전)
 *   5. 세분화 DLQ (ERR_CORRUPT_PDF, ERR_NO_TEXT, ERR_NO_DATE)
 *   6. Zero-API: pdf-parse + 정규식만, LLM 비용 0원
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { createClient } = require('@supabase/supabase-js');

// ═══ 설정 ═══════════════════════════════════════════════════
const PDF_FOLDER = path.join('C:', 'Users', 'admin', 'Desktop', '클로드연동_여행일정표');
const BATCH_SIZE = 50;
const MIN_TEXT_LENGTH = 50;
const PARSER_VERSION = 'v3.5-master-sku';
const DRY_RUN = process.argv.includes('--dry-run');
const TODAY = new Date().toISOString().slice(0, 10);

// ═══ IATA 항공사 매핑 (하드코딩) ════════════════════════════
const IATA_AIRLINE_MAP = {
  'BX': { code: 'BX', name: '에어부산', alliance: 'LCC' },
  'LJ': { code: 'LJ', name: '진에어', alliance: 'LCC' },
  'OZ': { code: 'OZ', name: '아시아나항공', alliance: 'Star' },
  'KE': { code: 'KE', name: '대한항공', alliance: 'SkyTeam' },
  '7C': { code: '7C', name: '제주항공', alliance: 'LCC' },
  'TW': { code: 'TW', name: '티웨이항공', alliance: 'LCC' },
  'VJ': { code: 'VJ', name: '비엣젯항공', alliance: 'LCC' },
  'ZE': { code: 'ZE', name: '이스타항공', alliance: 'LCC' },
  'RS': { code: 'RS', name: '에어서울', alliance: 'LCC' },
  'QV': { code: 'QV', name: '라오항공', alliance: 'FSC' },
  'JL': { code: 'JL', name: '일본항공', alliance: 'oneworld' },
  'NH': { code: 'NH', name: '전일본공수', alliance: 'Star' },
  'MU': { code: 'MU', name: '중국동방항공', alliance: 'SkyTeam' },
  'CA': { code: 'CA', name: '중국국제항공', alliance: 'Star' },
  'CZ': { code: 'CZ', name: '중국남방항공', alliance: 'SkyTeam' },
};

// ═══ 벤더 추론 룰 (하드코딩) ════════════════════════════════
const VENDOR_INFERENCE_RULES = [
  // 정확 매칭
  { pattern: '참좋은여행', code: 'CJ', name: '참좋은여행' },
  { pattern: '온라인투어', code: 'OL', name: '온라인투어' },
  { pattern: '베스트아시아', code: 'BA', name: '베스트아시아' },
  { pattern: '노랑풍선', code: 'NY', name: '노랑풍선' },
  { pattern: '롯데관광', code: 'LO', name: '롯데관광' },
  { pattern: '교원투어', code: 'KW', name: '교원투어' },
  { pattern: '인터파크', code: 'IP', name: '인터파크' },
  { pattern: '여행박사', code: 'YB', name: '여행박사' },
  { pattern: '자유투어', code: 'JY', name: '자유투어' },
  { pattern: '세중나모', code: 'SJ', name: '세중나모' },
  { pattern: '하나투어', code: 'HN', name: '하나투어' },
  { pattern: '모두투어', code: 'MD', name: '모두투어' },
  { pattern: '투어폰', code: 'TP', name: '투어폰' },
  { pattern: '투어비', code: 'TB', name: '투어비' },
  { pattern: 'ID투어', code: 'ID', name: 'ID투어' },
  // 이메일 추론
  { pattern: /tourb\d*@/i, code: 'TB', name: '투어비', type: 'regex' },
  { pattern: /hanatour/i, code: 'HN', name: '하나투어', type: 'regex' },
  { pattern: /modetour/i, code: 'MD', name: '모두투어', type: 'regex' },
  { pattern: /tourfon/i, code: 'TP', name: '투어폰', type: 'regex' },
];

const DEST_CODE_MAP = {
  '오사카': 'OSA', '도쿄': 'TYO', '후쿠오카': 'FUK', '삿포로': 'CTS', '오키나와': 'OKA',
  '방콕': 'BKK', '치앙마이': 'CNX', '싱가포르': 'SIN', '마카오': 'MAC',
  '홍콩': 'HKG', '대만': 'TPE', '타이베이': 'TPE',
  '하노이': 'HAN', '다낭': 'DAD', '호치민': 'SGN', '나트랑': 'CXR', '푸꾸옥': 'PQC',
  '세부': 'CEB', '마닐라': 'MNL', '발리': 'DPS', '쿠알라룸푸르': 'KUL',
  '장가계': 'DYG', '구이린': 'KWL', '베이징': 'PEK', '상하이': 'SHA',
  '연길': 'YNJ', '백두산': 'YNJ', '괌': 'GUM', '사이판': 'SPN', '하와이': 'HNL',
  '두바이': 'DXB', '이스탄불': 'IST', '런던': 'LHR', '파리': 'CDG',
  '라오스': 'VTE', '루앙프라방': 'LPQ', '방비엥': 'VTE',
};

const REGION_CODE_MAP = {
  '부산': 'PUS', '김해': 'PUS', '인천': 'ICN', '서울': 'ICN',
  '김포': 'GMP', '제주': 'CJU', '대구': 'TAE', '청주': 'CJJ', '광주': 'KWJ',
};

// ═══ 환경변수 ═══════════════════════════════════════════════
function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) { console.error('❌ .env.local 없음'); process.exit(1); }
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ══════════════════════════════════════════════════════════════
//  정규식 추출 엔진 v3.5
// ══════════════════════════════════════════════════════════════

function computeHash(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function extractDates(text) {
  const p = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g;
  const d = []; let m;
  while ((m = p.exec(text)) !== null) {
    const y = +m[1], mo = +m[2], da = +m[3];
    if (y >= 2020 && y <= 2030 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31)
      d.push(`${y}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`);
  }
  return [...new Set(d)];
}

function extractFirstDeparture(text, filename) {
  const candidates = [];
  // M/DD 패턴
  const slashP = /(\d{1,2})\/(\d{1,2})/g; let m;
  while ((m = slashP.exec(text)) !== null) {
    const mo = +m[1], da = +m[2];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31)
      candidates.push(`${new Date().getFullYear()}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`);
  }
  candidates.push(...extractDates(text));
  return candidates.length > 0 ? candidates.sort()[0] : null;
}

function extractTicketingDeadline(text, filename) {
  const fn = filename.match(/(\d{2})(\d{2})발권/);
  if (fn) { const y = new Date().getFullYear(); return `${y}-${fn[1]}-${fn[2]}`; }
  const tx = text.match(/발권\s*(?:마감|기한)?(?:일)?[:\s]*(\d{4})?[.\-\/]?(\d{1,2})[.\-\/](\d{1,2})/);
  if (tx) { const y = tx[1] ? +tx[1] : new Date().getFullYear(); return `${y}-${String(+tx[2]).padStart(2,'0')}-${String(+tx[3]).padStart(2,'0')}`; }
  return null;
}

function extractDuration(text, filename) {
  const c = filename + ' ' + text.slice(0, 2000);
  const bakil = c.match(/(\d+)박\s*(\d+)일/);
  if (bakil) return +bakil[2];
  const dayOnly = c.match(/(?:^|[^\d])(\d{1,2})일(?:\s|$|[^차정발])/);
  if (dayOnly && +dayOnly[1] <= 30) return +dayOnly[1];
  return 0;
}

function extractDestCode(text, filename) {
  const c = filename + ' ' + text.slice(0, 1000);
  const skip = ['제주', '부산', '경주', '강릉', '속초', '여수', '통영'];
  for (const [name, code] of Object.entries(DEST_CODE_MAP)) {
    if (c.includes(name) && !skip.includes(name)) return { name, code };
  }
  return { name: '', code: 'XXX' };
}

function extractAirline(text, filename) {
  const c = filename + ' ' + text.slice(0, 800);
  for (const code of Object.keys(IATA_AIRLINE_MAP)) {
    if (new RegExp(code + '\\d{2,4}').test(c)) return code;
  }
  for (const code of Object.keys(IATA_AIRLINE_MAP)) {
    if (c.includes(code)) return code;
  }
  return 'XX';
}

function extractDocType(text, filename) {
  if (filename.includes('특가') || text.includes('스팟특가')) return 'S';
  if (filename.includes('자유') || text.includes('자유여행')) return 'F';
  return 'P';
}

function extractDeparture(text, filename) {
  const c = filename + ' ' + text.slice(0, 500);
  for (const [r, code] of Object.entries(REGION_CODE_MAP)) {
    if (c.includes(r + '출발') || c.includes(r + ' 출발')) return { region: r, code };
  }
  if (c.includes('부산') || c.includes('김해')) return { region: '부산', code: 'PUS' };
  return { region: '부산', code: 'PUS' };
}

/** 벤더 추론 (3중 스캔) */
function inferVendor(text, filename) {
  const combined = filename + ' ' + text.slice(0, 3000);
  for (const rule of VENDOR_INFERENCE_RULES) {
    if (rule.type === 'regex') {
      if (rule.pattern.test(combined)) return { name: rule.name, code: rule.code };
    } else {
      if (combined.includes(rule.pattern)) return { name: rule.name, code: rule.code };
    }
  }
  return { name: '', code: '' };
}

/** 가격 추출 (모든 가격 수집) */
function extractPrices(text) {
  const prices = [];
  // 1인 XXX,000원
  const p1 = text.match(/1인\s*(\d{1,3}(?:,\d{3})+)원/);
  if (p1) prices.push(+p1[1].replace(/,/g, ''));
  // 일반 가격
  const p = /(\d{1,3}(?:,\d{3})+)원?/g; let m;
  while ((m = p.exec(text)) !== null) {
    const v = +m[1].replace(/,/g, '');
    if (v >= 100000 && v <= 10000000) prices.push(v);
  }
  return [...new Set(prices)].sort((a, b) => a - b);
}

function checkExpired(dates, deadline) {
  const all = [...dates]; if (deadline) all.push(deadline);
  if (all.length === 0) return false;
  const latest = all.sort().pop();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(latest) < today;
}

function extractRegionTags(text, filename) {
  const kw = ['다낭','하노이','호치민','나트랑','푸꾸옥','방콕','파타야','치앙마이','푸켓',
    '세부','보라카이','마닐라','발리','싱가포르','오사카','도쿄','후쿠오카','삿포로','오키나와',
    '홍콩','마카오','장가계','구이린','괌','사이판','하와이','라오스','루앙프라방','방비엥','몽골'];
  const c = filename + ' ' + text;
  return [...new Set(kw.filter(k => c.includes(k)))];
}

// ══════════════════════════════════════════════════════════════
//  Semantic Chunking (RAG용)
// ══════════════════════════════════════════════════════════════

function semanticChunk(text) {
  const chunks = [];

  // 일정표 추출: "제1일", "제2일", "Day 1", "1일차"
  const dayPattern = /(?:제(\d+)일|(\d+)일차|Day\s*(\d+))([\s\S]*?)(?=(?:제\d+일|\d+일차|Day\s*\d+|HOTEL|$))/gi;
  let dm;
  while ((dm = dayPattern.exec(text)) !== null) {
    const day = +(dm[1] || dm[2] || dm[3]);
    const content = dm[4].trim().slice(0, 2000);
    if (content.length > 20) chunks.push({ type: 'itinerary', day, content });
  }

  // 포함 사항
  const inclMatch = text.match(/포\s*함[\s\S]*?(?=불\s*포\s*함|불포함|R\s*M\s*K|유의|$)/i);
  if (inclMatch) {
    const content = inclMatch[0].trim().slice(0, 1500);
    if (content.length > 10) chunks.push({ type: 'inclusion', content });
  }

  // 불포함 사항
  const exclMatch = text.match(/(?:불\s*포\s*함|불포함)([\s\S]*?)(?=R\s*M\s*K|유의|취소|특이|$)/i);
  if (exclMatch) {
    const content = exclMatch[1].trim().slice(0, 1000);
    if (content.length > 5) chunks.push({ type: 'exclusion', content });
  }

  // 취소규정
  const cancelMatch = text.match(/(?:취소|환불|캔슬)([\s\S]*?)(?=$)/i);
  if (cancelMatch) {
    const content = cancelMatch[1].trim().slice(0, 1000);
    if (content.length > 10) chunks.push({ type: 'cancellation', content });
  }

  // 쇼핑 정보
  const shopMatch = text.match(/쇼핑\s*(?:센터|장)?[^.\n]*?(\d+)\s*회/);
  if (shopMatch) {
    chunks.push({ type: 'shopping', count: +shopMatch[1], content: shopMatch[0].trim() });
  }

  return chunks;
}

// ══════════════════════════════════════════════════════════════
//  Master-Child SKU 감지
// ══════════════════════════════════════════════════════════════

function detectChildProducts(text, filename) {
  const children = [];

  // "일정 中 택 1" 패턴 감지
  if (text.includes('택 1') || text.includes('택1')) {
    // 하위 상품 키워드 추출
    const subPatterns = [
      { pattern: /미식\s*투어/i, name: '미식투어' },
      { pattern: /오전\s*자유/i, name: '오전 자유' },
      { pattern: /반나절\s*자유/i, name: '반나절 자유' },
      { pattern: /실속/i, name: '실속' },
      { pattern: /프리미엄/i, name: '프리미엄' },
      { pattern: /고품격/i, name: '고품격' },
      { pattern: /노팁\s*노옵션/i, name: '노팁노옵션' },
    ];

    for (const sp of subPatterns) {
      if (sp.pattern.test(text)) {
        // 해당 하위 상품의 가격 추출 시도
        const priceAfter = text.slice(text.search(sp.pattern)).match(/(\d{1,3}(?:,\d{3})+)원?/);
        children.push({
          name: sp.name,
          price: priceAfter ? +priceAfter[1].replace(/,/g, '') : 0,
        });
      }
    }
  }

  // 실속 & 고품격 분리 (푸꾸옥 패턴)
  if (filename.includes('실속') && filename.includes('고품격')) {
    if (!children.some(c => c.name === '실속'))
      children.push({ name: '실속', price: 0 });
    if (!children.some(c => c.name === '고품격'))
      children.push({ name: '고품격', price: 0 });
  }

  return children;
}

// ══════════════════════════════════════════════════════════════
//  SKU 생성
// ══════════════════════════════════════════════════════════════

function generateSKU(docType, destCode, firstDate, duration, airline, seq) {
  const dateStr = firstDate ? firstDate.replace(/-/g, '').slice(2, 8) : '000000';
  return `${docType}${destCode}${dateStr}${String(duration).padStart(2,'0')}${airline}${String(seq).padStart(3,'0')}`;
}

// ══════════════════════════════════════════════════════════════
//  DB Operations
// ══════════════════════════════════════════════════════════════

async function getExistingSKUs() {
  const { data } = await supabase.from('archive_docs').select('sku_code').not('sku_code', 'is', null);
  return new Set((data || []).map(d => d.sku_code));
}

async function getExistingProductFns(fns) {
  const { data } = await supabase.from('products').select('source_filename').in('source_filename', fns);
  return new Set((data || []).map(d => d.source_filename));
}

async function upsertArchive(row) {
  if (DRY_RUN) return true;

  // 기존 데이터 조회 (price_history merge용)
  const { data: existing } = await supabase
    .from('archive_docs').select('metadata').eq('file_hash', row.file_hash).maybeSingle();

  if (existing && existing.metadata && existing.metadata.price_history) {
    // 기존 price_history에 append (중복 날짜 제외)
    const existingDates = new Set(existing.metadata.price_history.map(p => p.date));
    const newEntries = (row.metadata.price_history || []).filter(p => !existingDates.has(p.date));
    row.metadata.price_history = [...existing.metadata.price_history, ...newEntries];
  }

  let { error } = await supabase.from('archive_docs').upsert(row, { onConflict: 'file_hash' });
  // 컬럼이 아직 DB에 없으면 제거 후 재시도
  if (error && (error.message.includes('parsed_chunks') || error.message.includes('sku_code'))) {
    const fallbackRow = { ...row };
    delete fallbackRow.parsed_chunks;
    delete fallbackRow.sku_code;
    // sku_code를 metadata 안에 보존
    if (row.sku_code) fallbackRow.metadata = { ...fallbackRow.metadata, sku_code: row.sku_code };
    const r2 = await supabase.from('archive_docs').upsert(fallbackRow, { onConflict: 'file_hash' });
    error = r2.error;
  }
  if (error) { console.error(`  ❌ UPSERT 오류: ${error.message}`); return false; }
  return true;
}

async function generateProductCode(depCode, supCode, destCode, dur) {
  const prefix = `${depCode}-${supCode}-${destCode}-${String(dur || 5).padStart(2, '0')}`;
  const { data } = await supabase.from('products').select('internal_code')
    .like('internal_code', `${prefix}-%`).order('internal_code', { ascending: false }).limit(1);
  let seq = 1;
  if (data && data[0]) { const s = +data[0].internal_code.split('-').pop(); if (!isNaN(s)) seq = s + 1; }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

async function insertProduct(row) {
  if (DRY_RUN) return true;
  const { error } = await supabase.from('products').insert(row);
  if (error) {
    if (error.code === '23505') return true; // 중복 OK
    console.error(`  ❌ 상품 실패: ${error.message}`);
    return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════
//  단일 PDF 처리
// ══════════════════════════════════════════════════════════════

async function processPDF(file, seq, existingSKUs, existingProdFns) {
  const buffer = fs.readFileSync(file.fullPath);
  const fileHash = computeHash(buffer);

  // PDF 파싱
  let rawContent = '';
  let dlqCode = null;
  try {
    const parsed = await pdfParse(buffer);
    rawContent = parsed.text || '';
  } catch (err) {
    dlqCode = 'ERR_CORRUPT_PDF';
  }

  if (!dlqCode && rawContent.length < MIN_TEXT_LENGTH) dlqCode = 'ERR_NO_TEXT';

  // 추출
  const dest = extractDestCode(rawContent, file.name);
  const duration = extractDuration(rawContent, file.name);
  const firstDate = extractFirstDeparture(rawContent, file.name);
  const airline = extractAirline(rawContent, file.name);
  const docType = extractDocType(rawContent, file.name);
  const departure = extractDeparture(rawContent, file.name);
  const vendor = inferVendor(rawContent, file.name);
  const prices = extractPrices(rawContent);
  const dates = extractDates(rawContent);
  const deadline = extractTicketingDeadline(rawContent, file.name);
  const regionTags = extractRegionTags(rawContent, file.name);
  const expired = checkExpired(dates, deadline);
  const children = detectChildProducts(rawContent, file.name);
  const chunks = semanticChunk(rawContent);

  if (!dlqCode && !firstDate && dates.length === 0) dlqCode = 'ERR_NO_DATE';

  // SKU
  let sku = generateSKU(docType, dest.code, firstDate, duration, airline, seq);
  while (existingSKUs.has(sku)) { seq++; sku = generateSKU(docType, dest.code, firstDate, duration, airline, seq); }
  existingSKUs.add(sku);

  // Child SKUs
  const childSKUs = children.map((ch, idx) => ({
    ...ch,
    sku: `${sku}-C${String(idx + 1).padStart(2, '0')}`,
  }));

  // Price History
  const priceHistory = prices.length > 0
    ? [{ date: TODAY, prices, min: Math.min(...prices), max: Math.max(...prices), source: 'regex_v3.5' }]
    : [];

  const { cleanName, marginRate } = parseFilename(file.name);

  const status = dlqCode || 'processed';

  // Archive row
  const archiveRow = {
    file_hash: fileHash,
    sku_code: sku,
    original_file_name: file.name,
    original_file_path: file.fullPath,
    raw_content: dlqCode ? '' : rawContent,
    parsed_chunks: chunks,
    metadata: {
      // 식별
      sku_code: sku,
      doc_type: docType === 'P' ? 'package' : docType === 'S' ? 'spot_deal' : 'free_travel',
      // 여행 정보
      destination: dest.name,
      destination_code: dest.code,
      departure_region: departure.region,
      departure_code: departure.code,
      duration_days: duration,
      // 날짜
      travel_dates: dates,
      first_departure: firstDate,
      ticketing_deadline: deadline,
      expired,
      // 항공
      airline_code: airline,
      airline_name: IATA_AIRLINE_MAP[airline]?.name || '',
      airline_alliance: IATA_AIRLINE_MAP[airline]?.alliance || '',
      // 벤더
      vendor_name: vendor.name,
      vendor_code: vendor.code,
      // 가격
      net_price: prices[0] || 0,
      price_history: priceHistory,
      margin_rate: marginRate,
      // Master-Child
      child_skus: childSKUs,
      child_count: childSKUs.length,
      // 태그
      region_tags: regionTags,
      // 메타
      text_length: rawContent.length,
      chunk_count: chunks.length,
      product_registered: false,
      product_internal_code: null,
      extracted_at: new Date().toISOString(),
    },
    status,
    parser_version: PARSER_VERSION,
  };

  // Products 등록
  let productRow = null;
  const shouldRegister = !dlqCode && !expired && !existingProdFns.has(file.name);
  if (shouldRegister) {
    const supCode = vendor.code || 'ETC';
    const intCode = await generateProductCode(departure.code, supCode, dest.code, duration);
    productRow = {
      internal_code: intCode,
      display_name: cleanName || file.name.replace(/\.\w+$/, ''),
      departure_region: departure.region,
      supplier_code: supCode,
      net_price: prices[0] || 1,
      margin_rate: marginRate,
      discount_amount: 0,
      status: 'REVIEW_NEEDED',
      source_filename: file.name,
      raw_extracted_text: rawContent.slice(0, 50000),
      ai_confidence_score: 0,
      ai_tags: [],
      theme_tags: regionTags,
    };
    archiveRow.metadata.product_registered = true;
    archiveRow.metadata.product_internal_code = intCode;
  }

  return { archiveRow, productRow, status, expired, sku, childSKUs, vendor, dest, prices, duration, airline, chunks, dlqCode };
}

function parseFilename(filename) {
  const base = filename.replace(/\.\w+$/, '');
  const pct = filename.match(/(\d+(?:\.\d+)?)%/);
  const marginRate = pct ? parseFloat(pct[1]) / 100 : 0.10;
  const bracket = filename.match(/^\[([^\]]+)\](.+)\.\w+$/);
  if (bracket) return { cleanName: bracket[2].trim(), marginRate };
  return { cleanName: base.replace(/^★/, '').trim(), marginRate };
}

// ══════════════════════════════════════════════════════════════
//  메인 실행
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🗄️  여소남 OS — 궁극의 데이터 레이크 v3.5                    ║');
  console.log('║  📁 ' + PDF_FOLDER.padEnd(55) + '║');
  console.log('║  🔧 ' + PARSER_VERSION.padEnd(55) + '║');
  console.log('║  ' + (DRY_RUN ? '🔍 DRY-RUN' : '🚀 LIVE MODE').padEnd(57) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (!fs.existsSync(PDF_FOLDER)) { console.error('❌ 폴더 없음'); process.exit(1); }
  const pdfFiles = fs.readdirSync(PDF_FOLDER)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => ({ name: f, fullPath: path.join(PDF_FOLDER, f) }));

  console.log(`📄 PDF 발견: ${pdfFiles.length}개\n`);
  if (pdfFiles.length === 0) return;

  const existingSKUs = await getExistingSKUs();
  const existingProdFns = await getExistingProductFns(pdfFiles.map(f => f.name));

  // 처리
  const results = [];
  const dlqResults = [];
  const unknownVendors = [];
  let totalArchived = 0, totalProducts = 0, skuSeq = 1;

  for (let i = 0; i < pdfFiles.length; i++) {
    const file = pdfFiles[i];
    try {
      const r = await processPDF(file, skuSeq, existingSKUs, existingProdFns);
      skuSeq++;

      if (r.dlqCode) {
        dlqResults.push(r);
        console.log(`[${i+1}/${pdfFiles.length}] 🚫 ${r.dlqCode} | ${file.name}`);
      } else {
        results.push(r);
        const tag = r.expired ? '📦 만료' : r.productRow ? '🏷️  판매' : '🗄️  아카';
        const childInfo = r.childSKUs.length > 0 ? ` [${r.childSKUs.length} child]` : '';
        console.log(`[${i+1}/${pdfFiles.length}] ${tag} | ${r.sku}${childInfo} | ${file.name}`);
      }

      // UPSERT
      if (await upsertArchive(r.archiveRow)) totalArchived++;
      if (r.productRow && await insertProduct(r.productRow)) totalProducts++;

      if (!r.vendor.name && !r.dlqCode) unknownVendors.push(file.name);
    } catch (err) {
      console.error(`[${i+1}] ❌ ${file.name}: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  📊 경영자 보고서
  // ════════════════════════════════════════════════════════════

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  📊 경영자 보고서 — 데이터 레이크 적재 결과' + (DRY_RUN ? ' [DRY-RUN]' : '') + '          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // [성공] Master-SKU 계층 구조
  console.log('\n┌─── [성공] 마스터-SKU 계층 구조 ─────────────────────────────────┐');
  console.log('│ SKU              │ 분류 │ 지역 │ 항공 │ 가격       │ 벤더   │ 청크 │');
  console.log('├──────────────────┼──────┼──────┼──────┼────────────┼────────┼──────┤');
  for (const r of results) {
    const m = r.archiveRow.metadata;
    const tl = { 'package':'PKG', 'spot_deal':'SPOT', 'free_travel':'FREE' }[m.doc_type] || '?';
    const p = m.net_price ? `${(m.net_price/10000).toFixed(1)}만` : '-';
    const v = m.vendor_name ? m.vendor_name.slice(0,4) : '-';
    console.log(`│ ${r.sku.padEnd(16)} │ ${tl.padEnd(4)} │ ${m.destination_code.padEnd(4)} │ ${m.airline_code.padEnd(4)} │ ${p.padStart(10)} │ ${v.padEnd(6)} │ ${String(r.chunks.length).padStart(4)} │`);

    // Child SKUs
    for (const ch of r.childSKUs) {
      const cp = ch.price ? `${(ch.price/10000).toFixed(1)}만` : '-';
      console.log(`│   └─ ${ch.sku.padEnd(13)} │ ${ch.name.padEnd(4).slice(0,4)} │      │      │ ${cp.padStart(10)} │        │      │`);
    }
  }
  console.log('└──────────────────┴──────┴──────┴──────┴────────────┴────────┴──────┘');

  // [DLQ] 에러 코드
  console.log('\n┌─── [DLQ] 에러 코드별 발생 건수 ────────────────────────────────┐');
  if (dlqResults.length === 0) {
    console.log('│  ✅ DLQ 0건 — 전량 정상 처리                                    │');
  } else {
    const errCounts = {};
    for (const d of dlqResults) { errCounts[d.dlqCode] = (errCounts[d.dlqCode] || 0) + 1; }
    for (const [code, count] of Object.entries(errCounts)) {
      console.log(`│  🚫 ${code.padEnd(20)} ${count}건`.padEnd(63) + '│');
    }
  }
  console.log('└─────────────────────────────────────────────────────────────────┘');

  // [벤더] 미확인 랜드사
  console.log('\n┌─── [벤더] 미확인 랜드사 목록 ──────────────────────────────────┐');
  if (unknownVendors.length === 0) {
    console.log('│  ✅ 미확인 벤더 0건 — 전량 식별 완료                             │');
  } else {
    for (const fn of unknownVendors) {
      console.log(`│  ⚠️  ${fn.slice(0,55).padEnd(57)} │`);
    }
  }
  console.log('└─────────────────────────────────────────────────────────────────┘');

  // 총 요약
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  📄 전체 PDF:         ${pdfFiles.length}개`);
  console.log(`  🗄️  아카이브 UPSERT: ${totalArchived}개`);
  console.log(`  🏷️  상품 등록:       ${totalProducts}개 (검토 대기)`);
  console.log(`  📦 만료:            ${results.filter(r => r.expired).length}개`);
  console.log(`  🚫 DLQ:             ${dlqResults.length}개`);
  console.log(`  ⚠️  미확인 벤더:     ${unknownVendors.length}개`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
