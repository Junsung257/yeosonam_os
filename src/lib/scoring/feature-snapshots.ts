/**
 * Feature snapshots — 패키지 features 시점 캡처 + 변경 감지.
 *
 * recompute 시점에 호출:
 *   - 가장 최근 스냅샷 fetch
 *   - 현재 features와 diff
 *   - 변경된 축이 있으면 새 row INSERT (changed_axes 기록)
 *
 * 활용:
 *   - 랜드사가 호텔 4성→5성 업그레이드 → 자동 캡처
 *   - 옵션 추가/제거 추적
 *   - LTR 학습 시 시점별 features 정확히 매핑
 */
import { supabaseAdmin } from '@/lib/supabase';
import { postAlert } from '@/lib/admin-alerts';
import type { PackageFeatures } from './types';

/** 변경된 axis 중 사장님이 즉시 알아야 할 것들 — 알림 발생 트리거 */
const CRITICAL_AXES = new Set([
  'hotel_avg_grade',  // 호텔 등급 변동 (랜드사 다운그레이드/업그레이드)
  'shopping_count',   // 쇼핑 횟수 변동 (노쇼핑 → 쇼핑 추가 등)
  'is_direct_flight', // 직항 → 경유 변경
  'reliability_score', // 랜드사 신뢰도 급변
]);

interface SnapshotRow {
  id?: number;
  package_id: string;
  destination: string | null;
  duration_days: number | null;
  shopping_count: number | null;
  hotel_avg_grade: number | null;
  meal_count: number | null;
  free_option_count: number | null;
  is_direct_flight: boolean | null;
  reliability_score: number | null;
  confirmation_rate: number | null;
  free_time_ratio: number | null;
  korean_meal_count: number | null;
  special_meal_count: number | null;
  hotel_location: string | null;
  flight_time: string | null;
  climate_score: number | null;
  popularity_score: number | null;
}

const TRACKED_AXES: (keyof SnapshotRow)[] = [
  'shopping_count', 'hotel_avg_grade', 'meal_count', 'free_option_count',
  'is_direct_flight', 'reliability_score', 'confirmation_rate', 'free_time_ratio',
  'korean_meal_count', 'special_meal_count', 'hotel_location', 'flight_time',
  'climate_score', 'popularity_score',
];

function diffAxes(prev: SnapshotRow | null, curr: SnapshotRow): string[] {
  if (!prev) return TRACKED_AXES.map(String); // 첫 스냅샷
  const changed: string[] = [];
  for (const k of TRACKED_AXES) {
    const a = prev[k], b = curr[k];
    // numeric tolerance 0.01
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > 0.01) changed.push(String(k));
    } else if (a !== b) {
      changed.push(String(k));
    }
  }
  return changed;
}

export async function snapshotFeaturesIfChanged(
  features: PackageFeatures,
): Promise<{ inserted: boolean; changed_axes: string[] }> {
  const curr: SnapshotRow = {
    package_id: features.package_id,
    destination: features.destination,
    duration_days: features.duration_days,
    shopping_count: features.shopping_count,
    hotel_avg_grade: features.hotel_avg_grade,
    meal_count: features.meal_count,
    free_option_count: features.free_option_count,
    is_direct_flight: features.is_direct_flight,
    reliability_score: features.reliability_score,
    confirmation_rate: features.confirmation_rate,
    free_time_ratio: features.free_time_ratio,
    korean_meal_count: features.korean_meal_count,
    special_meal_count: features.special_meal_count,
    hotel_location: features.hotel_location,
    flight_time: features.flight_time,
    climate_score: features.climate_score,
    popularity_score: features.popularity_score,
  };

  // 가장 최근 스냅샷
  const { data: prevRows } = await supabaseAdmin
    .from('feature_snapshots')
    .select('id, ' + TRACKED_AXES.join(','))
    .eq('package_id', features.package_id)
    .order('snapshot_date', { ascending: false })
    .limit(1);
  const prev = (prevRows?.[0] ?? null) as SnapshotRow | null;
  const changed = diffAxes(prev, curr);

  // 변경 없으면 INSERT X (테이블 부담 ↓)
  if (prev && changed.length === 0) return { inserted: false, changed_axes: [] };

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabaseAdmin.from('feature_snapshots').insert({
    snapshot_date: today,
    ...curr,
    prev_snapshot_id: (prev as SnapshotRow & { id?: number })?.id ?? null,
    changed_axes: changed,
  });
  if (error) {
    console.error('[feature-snapshot]', error.message);
    return { inserted: false, changed_axes: [] };
  }

  // critical axis 변경 시 admin alert (첫 스냅샷은 noise라 prev 있을 때만)
  if (prev) {
    const criticalChanges = changed.filter(a => CRITICAL_AXES.has(a));
    if (criticalChanges.length > 0) {
      const lines = criticalChanges.map(axis => {
        const prevVal = (prev as unknown as Record<string, unknown>)[axis];
        const currVal = (curr as unknown as Record<string, unknown>)[axis];
        return `${axis}: ${String(prevVal)} → ${String(currVal)}`;
      });
      await postAlert({
        category: 'feature_change',
        severity: criticalChanges.includes('hotel_avg_grade') || criticalChanges.includes('is_direct_flight') ? 'warning' : 'info',
        title: `패키지 features 변경: ${criticalChanges.join(', ')}`,
        message: lines.join(' / '),
        ref_type: 'package',
        ref_id: features.package_id,
        meta: { changed_axes: criticalChanges, snapshot_date: today },
        dedupe: true,
      });
    }
  }

  return { inserted: true, changed_axes: changed };
}

/** 배치용 — 여러 features 한 번에 처리 (recompute cron에서 호출) */
export async function snapshotBatch(allFeatures: PackageFeatures[]): Promise<{ inserted: number; total: number }> {
  // 패키지별 dedupe (한 recompute에서 같은 package_id 여러 출발일 N회)
  const seen = new Set<string>();
  const unique: PackageFeatures[] = [];
  for (const f of allFeatures) {
    if (seen.has(f.package_id)) continue;
    seen.add(f.package_id);
    unique.push(f);
  }
  let inserted = 0;
  for (const f of unique) {
    const r = await snapshotFeaturesIfChanged(f);
    if (r.inserted) inserted++;
  }
  return { inserted, total: unique.length };
}
