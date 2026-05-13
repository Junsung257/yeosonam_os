/**
 * @file land-operator-profile.ts
 * @description 랜드사별 추출 프로파일 로더 + 자동 누적 학습.
 *
 * 박제 사유 (Phase 5-2 + 6-2, 2026-05-13):
 * 랜드사마다 원문 형식이 다름 (LJ ★특전, 모두투어 ▶ 마커 등).
 * 등록 누적할수록 같은 랜드사 추출이 compound 로 정확해지도록 학습.
 *
 * 흐름:
 *   1. parseTextWithAI 가 호출 시 landOperatorId 기반 프로파일 로드
 *   2. typical_markers / extraction_hint 를 systemPrompt 에 inject
 *   3. 등록 완료 후 자동 누적 (이번 원문의 마커 패턴 학습)
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface LandOperatorProfile {
  land_operator_id:     string;
  typical_markers:      string[];
  typical_inclusions:   string[];
  typical_excludes:     string[];
  typical_surcharge:    string[];
  typical_b2b_terms:    string[];
  extraction_hint:      string | null;
  total_registrations:  number;
  total_rejections:     number;
  avg_confidence:       number | null;
}

const cache = new Map<string, { profile: LandOperatorProfile; expiry: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getLandOperatorProfile(landOperatorId: string | null | undefined): Promise<LandOperatorProfile | null> {
  if (!landOperatorId || !isSupabaseConfigured) return null;
  const cached = cache.get(landOperatorId);
  if (cached && Date.now() < cached.expiry) return cached.profile;

  try {
    const { data } = await supabaseAdmin
      .from('land_operator_extraction_profile')
      .select('*')
      .eq('land_operator_id', landOperatorId)
      .maybeSingle();
    if (!data) return null;
    const profile = data as LandOperatorProfile;
    cache.set(landOperatorId, { profile, expiry: Date.now() + TTL_MS });
    return profile;
  } catch {
    return null;
  }
}

/** systemPrompt 합성용 fragment */
export function buildProfilePromptFragment(profile: LandOperatorProfile | null | undefined): string {
  if (!profile) return '';
  const lines: string[] = [];
  if (profile.extraction_hint) {
    lines.push(`## 랜드사 추출 힌트\n${profile.extraction_hint}`);
  }
  if (profile.typical_markers?.length) {
    lines.push(`## 이 랜드사 원문 마커\n${profile.typical_markers.map(m => `- "${m}"`).join('\n')}`);
  }
  if (profile.typical_b2b_terms?.length) {
    lines.push(`## 이 랜드사 B2B 용어 (고객 표현으로 치환 필요)\n${profile.typical_b2b_terms.map(t => `- "${t}"`).join('\n')}`);
  }
  return lines.length > 0 ? '\n\n' + lines.join('\n\n') : '';
}

/**
 * 등록 후 자동 누적 — 이번 추출 결과에서 마커/B2B 용어 학습.
 * fire-and-forget 호출.
 */
export async function accumulateLandOperatorProfile(args: {
  landOperatorId: string;
  rawText: string;
  confidence: number;
  rejected: boolean;
  detectedB2bTerms?: string[]; // sanitizer 의 incidents 에서 추출
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    // 1) 현재 프로파일 로드 (없으면 새로 생성)
    const { data: existing } = await supabaseAdmin
      .from('land_operator_extraction_profile')
      .select('*')
      .eq('land_operator_id', args.landOperatorId)
      .maybeSingle();

    // 2) 마커 자동 감지 (원문에서)
    const markersDetected = new Set<string>();
    const markerCandidates = ['▶', '★', '♥', '◈', '☞', '✦', '●', '■'];
    for (const m of markerCandidates) {
      if (args.rawText.includes(m)) markersDetected.add(m);
    }

    // 3) 누적 (union 마커 + B2B 용어, 통계 업데이트)
    const cur = (existing as LandOperatorProfile | null) ?? {
      land_operator_id: args.landOperatorId,
      typical_markers: [],
      typical_inclusions: [],
      typical_excludes: [],
      typical_surcharge: [],
      typical_b2b_terms: [],
      extraction_hint: null,
      total_registrations: 0,
      total_rejections: 0,
      avg_confidence: null,
    };

    const newMarkers = Array.from(new Set([...(cur.typical_markers ?? []), ...markersDetected]));
    const newB2b    = Array.from(new Set([...(cur.typical_b2b_terms ?? []), ...(args.detectedB2bTerms ?? [])])).slice(0, 50);
    const newTotal  = cur.total_registrations + 1;
    const newReject = cur.total_rejections + (args.rejected ? 1 : 0);
    const newAvg = cur.avg_confidence != null
      ? (cur.avg_confidence * cur.total_registrations + args.confidence) / newTotal
      : args.confidence;

    await supabaseAdmin
      .from('land_operator_extraction_profile')
      .upsert({
        land_operator_id:    args.landOperatorId,
        typical_markers:     newMarkers,
        typical_b2b_terms:   newB2b,
        total_registrations: newTotal,
        total_rejections:    newReject,
        avg_confidence:      Math.round(newAvg * 1000) / 1000,
        last_updated_at:     new Date().toISOString(),
      }, { onConflict: 'land_operator_id' });

    cache.delete(args.landOperatorId);
  } catch (e) {
    console.warn('[LandOp-Profile] 누적 실패(무시):', (e as Error).message);
  }
}
