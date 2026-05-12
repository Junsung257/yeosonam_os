import { supabaseAdmin } from '@/lib/supabase';

export interface MatchResult {
  total: number;
  matched_via_bookings: number;
  matched_via_aliases: number;
  unmapped_count: number;
  unmapped_packages: Array<{ id: string; title: string }>;
}

/**
 * travel_packages.land_operator_id 자동 매핑.
 *
 * 우선순위:
 *   1) bookings 에서 해당 패키지의 가장 자주 등장한 land_operator_id (mode)
 *   2) title/internal_code 에서 land_operators.name 또는 aliases 매칭
 *   3) 매칭 실패 → unmapped_packages 리포트
 *
 * 이미 land_operator_id 가 있는 패키지는 건너뜀.
 */
export async function matchPackagesToLandOperators(): Promise<MatchResult> {
  // 1) 매핑 안 된 활성 패키지
  const { data: pkgs, error: pkgErr } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, internal_code')
    .is('land_operator_id', null)
    .in('status', ['approved', 'active']);
  if (pkgErr) throw new Error(`패키지 조회 실패: ${pkgErr.message}`);
  const packages = pkgs ?? [];
  if (packages.length === 0) {
    return { total: 0, matched_via_bookings: 0, matched_via_aliases: 0, unmapped_count: 0, unmapped_packages: [] };
  }

  // 2) bookings 기반 매핑
  const pkgIds = packages.map((p: { id: string }) => p.id);
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('package_id, land_operator_id')
    .in('package_id', pkgIds)
    .not('land_operator_id', 'is', null)
    .eq('is_deleted', false);

  // 패키지별 land_operator_id 빈도 집계
  const freqByPkg = new Map<string, Map<string, number>>();
  for (const b of (bookings ?? []) as Array<{ package_id: string; land_operator_id: string }>) {
    if (!b.package_id || !b.land_operator_id) continue;
    if (!freqByPkg.has(b.package_id)) freqByPkg.set(b.package_id, new Map());
    const m = freqByPkg.get(b.package_id)!;
    m.set(b.land_operator_id, (m.get(b.land_operator_id) ?? 0) + 1);
  }
  const mode = (m: Map<string, number>): string | null => {
    let best: string | null = null;
    let bestN = 0;
    for (const [k, v] of m.entries()) if (v > bestN) { bestN = v; best = k; }
    return best;
  };

  // 3) aliases 기반 fallback 준비
  const { data: ops } = await supabaseAdmin
    .from('land_operators')
    .select('id, name, aliases')
    .eq('is_active', true);
  const operators = (ops ?? []) as Array<{ id: string; name: string; aliases: string[] | null }>;

  const matchByText = (text: string): string | null => {
    const lc = text.toLowerCase();
    for (const op of operators) {
      if (op.name && lc.includes(op.name.toLowerCase())) return op.id;
      for (const alias of op.aliases ?? []) {
        if (alias && lc.includes(alias.toLowerCase())) return op.id;
      }
    }
    return null;
  };

  let viaBookings = 0;
  let viaAliases = 0;
  const unmapped: Array<{ id: string; title: string }> = [];

  for (const pkg of packages) {
    let opId: string | null = null;

    const freq = freqByPkg.get(pkg.id);
    if (freq) {
      opId = mode(freq);
      if (opId) viaBookings++;
    }
    if (!opId) {
      const text = `${pkg.title ?? ''} ${pkg.internal_code ?? ''}`;
      opId = matchByText(text);
      if (opId) viaAliases++;
    }

    if (opId) {
      const { error: upErr } = await supabaseAdmin
        .from('travel_packages')
        .update({ land_operator_id: opId })
        .eq('id', pkg.id);
      if (upErr) console.error(`[match-land-ops] ${pkg.id} update 실패:`, upErr.message);
    } else {
      unmapped.push({ id: pkg.id, title: pkg.title ?? '(제목 없음)' });
    }
  }

  return {
    total: packages.length,
    matched_via_bookings: viaBookings,
    matched_via_aliases: viaAliases,
    unmapped_count: unmapped.length,
    unmapped_packages: unmapped,
  };
}
