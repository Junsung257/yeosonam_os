#!/usr/bin/env node
/**
 * @file db/dump_package_result.js
 * @description 방금 등록·활성화한 상품의 실제 판매 필드 전부를 한 화면으로 덤프.
 *
 * register.md Step 7-C "최종 리포트 사용자에게 출력 (한 화면)" 을 자동화.
 * Agent 가 INSERT + approve 후 호출 → 사장님에게 실제 DB 값 풀덤프 제공 (재요청 없게).
 *
 * 사용:
 *   node db/dump_package_result.js <id1> <id2> ...
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
  const env = {};
  envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
  return env;
}

async function main() {
  const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (ids.length === 0) {
    console.error('사용: node db/dump_package_result.js <id1> <id2> ...');
    process.exit(2);
  }

  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await sb.from('travel_packages').select('*').in('id', ids);
  if (error) { console.error('❌', error.message); process.exit(1); }

  const BASE = env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

  for (const p of (data || []).sort((a, b) => (a.short_code || '').localeCompare(b.short_code || ''))) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`📦 ${p.short_code} — ${p.title}`);
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`id                 : ${p.id}`);
    console.log(`status             : ${p.status}   audit_status: ${p.audit_status ?? 'null'}`);
    // P1 #5 (2026-04-27): 정액 마진 우선 표기 (commission_fixed_amount).
    // commission_rate=0 + fixed_amount 있으면 정액 모드, 그 외는 % 모드.
    if (p.commission_fixed_amount != null && Number(p.commission_fixed_amount) > 0) {
      const cur = p.commission_currency || 'KRW';
      const num = Number(p.commission_fixed_amount);
      const display = cur === 'KRW' ? `${num.toLocaleString('ko-KR')}원/건 정액`
                    : cur === 'USD' ? `$${num.toLocaleString('en-US')}/건 정액`
                    : cur === 'JPY' ? `¥${num.toLocaleString('ja-JP')}/건 정액`
                    : cur === 'CNY' ? `${num.toLocaleString('zh-CN')}元/건 정액`
                    : `${cur} ${num.toLocaleString('ko-KR')}/건 정액`;
      console.log(`commission         : ${display}`);
    } else {
      console.log(`commission_rate    : ${p.commission_rate}%`);
    }
    console.log(`ticketing_deadline : ${p.ticketing_deadline ?? 'null'}`);
    console.log(`destination        : ${p.destination} (${p.country})`);
    console.log(`duration           : ${p.nights}박 ${p.duration}일`);
    console.log(`departure          : ${p.departure_airport} / ${p.airline} / ${p.departure_days}`);
    console.log(`min_participants   : ${p.min_participants}명`);
    // P0 #3: single_supplement 가 string("평일 30,000원/박/인 · 금토 40,000원/박/인") 일 때
    // toLocaleString() 호출하면 string 그대로 + "원" 붙어 "박/인원" 충돌. string/number 분기.
    {
      const ss = p.single_supplement;
      const display =
        ss == null || ss === '' ? '0원' :
        typeof ss === 'number' ? `${ss.toLocaleString()}원` :
        String(ss);
      console.log(`single_supplement  : ${display}`);
    }
    console.log(`product_type       : ${p.product_type}  (trip_style: ${p.trip_style})`);
    console.log(`price (최저가)     : ${(p.price || 0).toLocaleString()}원`);

    console.log('\n🗓️  price_dates (출발일·가격):');
    (p.price_dates || []).forEach(d =>
      console.log(`    ${d.date}  ${(d.price || 0).toLocaleString()}원${d.confirmed ? '  [출확]' : ''}`)
    );

    console.log('\n✅ inclusions:');
    (p.inclusions || []).forEach(x => console.log(`    • ${x}`));

    console.log('\n❌ excludes:');
    (p.excludes || []).forEach(x => console.log(`    • ${x}`));

    if (Array.isArray(p.surcharges) && p.surcharges.length > 0) {
      console.log('\n💵 surcharges (객체 배열):');
      p.surcharges.forEach(s => console.log(`    • ${s.name}  ${s.start ?? ''}~${s.end ?? ''}  ${s.amount ?? ''} ${s.currency ?? ''}${s.unit ? '/' + s.unit : ''}`));
    }

    console.log('\n🏨 accommodations:');
    (p.accommodations || []).forEach(x => console.log(`    • ${x}`));

    console.log('\n✨ product_highlights:');
    (p.product_highlights || []).forEach(x => console.log(`    • ${x}`));

    console.log('\n💬 product_summary:');
    console.log(`    ${p.product_summary || '(null)'}`);

    console.log('\n📋 notices_parsed:');
    (p.notices_parsed || []).forEach(n => console.log(`    [${n.type}] ${n.title}`));

    if (Array.isArray(p.optional_tours) && p.optional_tours.length > 0) {
      console.log('\n💎 optional_tours:');
      p.optional_tours.forEach(t => console.log(`    • ${t.name} — ${t.price ?? ''}${t.region ? '  ('+t.region+')' : ''}`));
    }

    console.log(`\n🏷️  product_tags: ${(p.product_tags || []).join(' ')}`);
    if (p.special_notes) console.log(`\n📝 special_notes: ${p.special_notes}`);

    const meta = p.itinerary_data?.meta || {};
    console.log('\n🛫 itinerary_data.meta:');
    console.log(`    flight_out=${meta.flight_out}  flight_in=${meta.flight_in}  airline=${meta.airline}`);
    console.log(`    room_type=${meta.room_type}  brand=${meta.brand}`);

    if (Array.isArray(p.itinerary) && p.itinerary.length > 0) {
      console.log('\n📅 일정 요약 (itinerary):');
      p.itinerary.forEach(x => console.log(`    ${x}`));
    }

    if (p.agent_audit_report) {
      const ar = p.agent_audit_report;
      console.log('\n🧠 agent_audit_report:');
      console.log(`    verdict=${ar.overall_verdict}  CRITICAL=${ar.unsupported_critical}  HIGH=${ar.unsupported_high}`);
      (ar.claims || []).forEach(c =>
        console.log(`    [${c.severity}] ${c.field} — ${c.supported ? '✅' : '❌'} ${c.text}`)
      );
    }

    console.log('\n🔗 URL');
    console.log(`    모바일:   ${BASE}/packages/${p.id}`);
    console.log(`    A4:       http://localhost:3000/admin/packages/${p.id}/poster`);
    console.log(`    어드민:   http://localhost:3000/admin/packages/${p.id}`);
    console.log('');
  }
}

main().catch(err => { console.error('💥', err); process.exit(1); });
