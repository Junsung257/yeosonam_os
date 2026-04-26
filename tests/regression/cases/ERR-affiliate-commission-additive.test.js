/**
 * @case ERR-affiliate-commission-additive (2026-04-26)
 * @summary 어필리에이터 커미션은 가산식이어야 함.
 *   final = base(상품) + tier(등급) + Σcampaign  ↓ min(cap)
 *
 *   ❌ 과거 곱셈식: rate * (1 + bonus_rate)
 *   ✅ 신규 가산식: rate + bonus_rate + Σcampaigns  ↓ cap
 *
 *   - exclusive 캠페인 1개라도 있으면 그것만 단독 적용 (가장 높은 rate)
 *   - 캡(cap)은 항상 마지막에 적용
 *   - 음수/NaN/잘못된 값은 0으로 정규화
 *
 * 회귀: applyCommissionPolicies 의 핵심 로직을 mock policy 로 단위 테스트.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// policy-engine.ts 의 핵심 계산 로직만 추출 (의존성 없는 순수 함수)
function calcCommission(ctx, policies) {
  const base = Math.max(0, Number(ctx.base_rate) || 0);
  const tier = Math.max(0, Number(ctx.tier_bonus) || 0);

  const eligibleCampaigns = [];
  let cap = null;

  for (const p of policies) {
    const cfg = p.action_config || {};
    if (p.action_type === 'commission_cap') {
      const r = Number(cfg.max_rate);
      if (Number.isFinite(r) && r >= 0 && (cap === null || r < cap)) cap = r;
    } else if (p.action_type === 'commission_campaign_bonus') {
      const rate = Number(cfg.rate);
      if (Number.isFinite(rate) && rate > 0) {
        eligibleCampaigns.push({ name: p.name, rate, exclusive: cfg.exclusive === true });
      }
    }
  }

  let campaigns;
  const exclusives = eligibleCampaigns.filter(c => c.exclusive);
  if (exclusives.length > 0) {
    const top = exclusives.reduce((a, b) => (b.rate > a.rate ? b : a));
    campaigns = [top];
  } else {
    campaigns = eligibleCampaigns;
  }
  const campaignSum = campaigns.reduce((s, c) => s + c.rate, 0);
  const rawTotal = base + tier + campaignSum;
  const finalRate = cap !== null ? Math.min(rawTotal, cap) : rawTotal;
  const round4 = n => Math.round(n * 10000) / 10000;

  return {
    base: round4(base),
    tier: round4(tier),
    campaigns: campaigns.map(c => ({ ...c, rate: round4(c.rate) })),
    raw_total: round4(rawTotal),
    cap,
    final_rate: round4(finalRate),
    capped: cap !== null && rawTotal > cap,
  };
}

test('가산식: 상품 2% + 등급 0.2% (캠페인 0건) → 2.2%', () => {
  const r = calcCommission({ base_rate: 0.02, tier_bonus: 0.002 }, []);
  assert.equal(r.final_rate, 0.022);
  assert.equal(r.capped, false);
});

test('가산식: 상품 2% + 등급 0.2% + 캠페인 1% = 3.2%', () => {
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0.002 },
    [{ action_type: 'commission_campaign_bonus', name: '4월이벤트', action_config: { rate: 0.01 } }],
  );
  assert.equal(r.final_rate, 0.032);
  assert.equal(r.campaigns.length, 1);
});

test('가산식 캡: 상품 2% + 등급 2% + 캠페인 5% = 9% → 캡 7% 적용', () => {
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0.02 },
    [
      { action_type: 'commission_campaign_bonus', name: '대박이벤트', action_config: { rate: 0.05 } },
      { action_type: 'commission_cap', name: '글로벌캡', action_config: { max_rate: 0.07 } },
    ],
  );
  assert.equal(r.raw_total, 0.09);
  assert.equal(r.final_rate, 0.07);
  assert.equal(r.capped, true);
});

test('가산식: 캠페인 2개 동시 활성 → 모두 가산', () => {
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0 },
    [
      { action_type: 'commission_campaign_bonus', name: '캠A', action_config: { rate: 0.005 } },
      { action_type: 'commission_campaign_bonus', name: '캠B', action_config: { rate: 0.01 } },
    ],
  );
  assert.equal(r.final_rate, 0.035); // 2 + 0.5 + 1
  assert.equal(r.campaigns.length, 2);
});

test('가산식 exclusive: exclusive 캠페인 1개라도 있으면 그것만 단독', () => {
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0.005 },
    [
      { action_type: 'commission_campaign_bonus', name: '일반캠', action_config: { rate: 0.005 } },
      { action_type: 'commission_campaign_bonus', name: '단독캠', action_config: { rate: 0.02, exclusive: true } },
    ],
  );
  // base 2% + tier 0.5% + 단독 2% = 4.5% (일반캠 0.5% 무시)
  assert.equal(r.final_rate, 0.045);
  assert.equal(r.campaigns.length, 1);
  assert.equal(r.campaigns[0].name, '단독캠');
});

test('가산식 exclusive 다수: 가장 높은 rate 만 적용', () => {
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0 },
    [
      { action_type: 'commission_campaign_bonus', name: '단독A', action_config: { rate: 0.01, exclusive: true } },
      { action_type: 'commission_campaign_bonus', name: '단독B', action_config: { rate: 0.03, exclusive: true } },
    ],
  );
  assert.equal(r.final_rate, 0.05); // 2% + 3%(B만)
  assert.equal(r.campaigns[0].name, '단독B');
});

test('방어: 음수 rate 무시', () => {
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0 },
    [{ action_type: 'commission_campaign_bonus', name: '잘못된정책', action_config: { rate: -0.05 } }],
  );
  assert.equal(r.final_rate, 0.02); // 캠페인 무시
  assert.equal(r.campaigns.length, 0);
});

test('방어: NaN base_rate 는 0 으로', () => {
  const r = calcCommission({ base_rate: NaN, tier_bonus: 0.005 }, []);
  assert.equal(r.base, 0);
  assert.equal(r.final_rate, 0.005);
});

test('방어: 캡이 raw_total 보다 크면 capped=false', () => {
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0.005 },
    [{ action_type: 'commission_cap', name: '캡', action_config: { max_rate: 0.07 } }],
  );
  assert.equal(r.final_rate, 0.025);
  assert.equal(r.capped, false);
});

test('방어: 캡 다중 → 가장 작은 캡 적용', () => {
  const r = calcCommission(
    { base_rate: 0.05, tier_bonus: 0.02 },
    [
      { action_type: 'commission_campaign_bonus', name: '큰캠', action_config: { rate: 0.05 } },
      { action_type: 'commission_cap', name: '캡10%', action_config: { max_rate: 0.10 } },
      { action_type: 'commission_cap', name: '캡7%', action_config: { max_rate: 0.07 } },
    ],
  );
  assert.equal(r.cap, 0.07);
  assert.equal(r.final_rate, 0.07);
  assert.equal(r.capped, true);
});

test('실전 시나리오: 신규(브론즈) + 4월 이벤트 1%', () => {
  // 상품 2%(고정) + 브론즈 0% + 4월 이벤트 1% = 3%
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0 },
    [{ action_type: 'commission_campaign_bonus', name: '4월이벤트', action_config: { rate: 0.01 } }],
  );
  assert.equal(r.final_rate, 0.03);
});

test('실전 시나리오: 다이아 등급 + 4월 이벤트 + 캡 7%', () => {
  // 상품 2% + 다이아 +2% + 4월 이벤트 +1% = 5%, 캡 7% 미적용
  const r = calcCommission(
    { base_rate: 0.02, tier_bonus: 0.02 },
    [
      { action_type: 'commission_campaign_bonus', name: '4월', action_config: { rate: 0.01 } },
      { action_type: 'commission_cap', name: '캡', action_config: { max_rate: 0.07 } },
    ],
  );
  assert.equal(r.final_rate, 0.05);
  assert.equal(r.capped, false);
});

test('스냅샷 무결성: 같은 입력 → 같은 출력 (deterministic)', () => {
  const ctx = { base_rate: 0.02, tier_bonus: 0.005 };
  const policies = [
    { action_type: 'commission_campaign_bonus', name: 'X', action_config: { rate: 0.01 } },
  ];
  const r1 = calcCommission(ctx, policies);
  const r2 = calcCommission(ctx, policies);
  assert.deepEqual(r1, r2);
});
