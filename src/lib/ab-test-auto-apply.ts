import { supabaseAdmin } from "@/lib/supabase";

export interface AutoApplyResult {
  experimentId: string;
  creativeId: string;
  winnerVariantId: string;
  variantType: string;
  success: boolean;
  appliedTo: string[];
  error?: string;
}

/**
 * 완료된 A/B 실험의 승자 variant를 실제 콘텐츠에 적용한다.
 *
 * variant_type에 따라 다른 컬럼을 업데이트:
 * - 'headline'   → content_creatives.seo_title
 * - 'cta'        → content_creatives.cta_text
 * - 'og_image'   → content_creatives.og_image_url
 * - 'full_content' → 콘텐츠가 크므로 이 함수에서는 건너뜀 (별도 처리 필요)
 */
export async function applyWinners(): Promise<AutoApplyResult[]> {
  const results: AutoApplyResult[] = [];

  try {
    // 1. 완료된 실험 중 승자가 결정된 것만 조회
    const { data: experiments, error } = await supabaseAdmin
      .from("ab_experiments")
      .select("id, creative_id, winner_variant_id, variant_type, name")
      .eq("status", "completed")
      .not("winner_variant_id", "is", null);

    if (error) {
      console.error("[ab-test-auto-apply] 실험 조회 실패:", error.message);
      return results;
    }

    if (!experiments || experiments.length === 0) {
      console.log("[ab-test-auto-apply] 적용할 승자가 있는 완료된 실험이 없습니다.");
      return results;
    }

    console.log(
      `[ab-test-auto-apply] ${experiments.length}개 실험 승자 적용 시작`
    );

    for (const exp of experiments) {
      const experimentId = exp.id as string;
      const creativeId = exp.creative_id as string;
      const winnerVariantId = exp.winner_variant_id as string;
      const variantType = exp.variant_type as string;

      try {
        // 2. 승자 variant 조회
        const { data: variant, error: variantError } = await supabaseAdmin
          .from("ab_variants")
          .select("variant_value")
          .eq("id", winnerVariantId)
          .single();

        if (variantError || !variant) {
          results.push({
            experimentId,
            creativeId,
            winnerVariantId,
            variantType,
            success: false,
            appliedTo: [],
            error: `Variant 조회 실패: ${variantError?.message || "데이터 없음"}`,
          });
          continue;
        }

        const variantValue = variant.variant_value as string;

        // 3. variant_type에 따라 업데이트할 컬럼 결정
        const updatePayload: Record<string, string> = {};
        const appliedTo: string[] = [];

        switch (variantType) {
          case "headline":
            updatePayload.seo_title = variantValue;
            appliedTo.push("content_creatives.seo_title");
            break;

          case "cta":
            updatePayload.cta_text = variantValue;
            appliedTo.push("content_creatives.cta_text");
            break;

          case "og_image":
            updatePayload.og_image_url = variantValue;
            appliedTo.push("content_creatives.og_image_url");
            break;

          case "full_content":
            // full_content는 blog_html 전체를 교체해야 하므로
            // 이 자동 적용 함수에서는 건너뜀
            results.push({
              experimentId,
              creativeId,
              winnerVariantId,
              variantType,
              success: false,
              appliedTo: [],
              error: "full_content 타입은 자동 적용 대상이 아닙니다. 별도 처리 필요.",
            });
            continue;

          default:
            results.push({
              experimentId,
              creativeId,
              winnerVariantId,
              variantType,
              success: false,
              appliedTo: [],
              error: `알 수 없는 variant_type: ${variantType}`,
            });
            continue;
        }

        // 4. content_creatives 업데이트
        const { error: updateError } = await supabaseAdmin
          .from("content_creatives")
          .update(updatePayload)
          .eq("id", creativeId);

        if (updateError) {
          results.push({
            experimentId,
            creativeId,
            winnerVariantId,
            variantType,
            success: false,
            appliedTo: [],
            error: `DB 업데이트 실패: ${updateError.message}`,
          });
          continue;
        }

        // 5. 적용 완료 — 실험을 archived 처리
        await supabaseAdmin
          .from("ab_experiments")
          .update({ status: "archived" })
          .eq("id", experimentId);

        console.log(
          `[ab-test-auto-apply] 실험 ${experimentId} (${exp.name}) 승자 적용 완료 → ${appliedTo.join(", ")}`
        );

        results.push({
          experimentId,
          creativeId,
          winnerVariantId,
          variantType,
          success: true,
          appliedTo,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "알 수 없는 오류";
        console.error(
          `[ab-test-auto-apply] 실험 ${experimentId} 처리 실패:`,
          message
        );
        results.push({
          experimentId,
          creativeId,
          winnerVariantId,
          variantType,
          success: false,
          appliedTo: [],
          error: message,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    console.error("[ab-test-auto-apply] 전체 처리 실패:", message);
  }

  return results;
}
