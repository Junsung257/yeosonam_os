import { hashRawText } from '@/lib/source-evidence';
import { createSourceLineIndex } from './source-line-index';
import { planProductRegistrationV3 } from './structure-planner';
import { buildProductRegistrationV3Ledger } from './ledger-builder';
import { applyProductRegistrationV3Matching } from './matcher';
import { evaluateProductRegistrationV3Gate } from './gate';
import { ledgerToRenderPackageInputs } from './render-contract-adapter';
import type { V3PipelineResult, V3RunOptions } from './types';

export async function runProductRegistrationV3(
  rawText: string,
  options: V3RunOptions = {},
): Promise<V3PipelineResult> {
  const sourceIndex = createSourceLineIndex(rawText);
  const structurePlan = planProductRegistrationV3(sourceIndex);
  const initialLedger = buildProductRegistrationV3Ledger(sourceIndex, structurePlan);
  const { ledger, matchSummary } = applyProductRegistrationV3Matching(
    initialLedger,
    options.attractions ?? [],
    options.supplierHint ?? undefined,
  );
  const gateResult = evaluateProductRegistrationV3Gate(structurePlan, ledger);
  return {
    raw_text_hash: hashRawText(rawText),
    source_index: sourceIndex,
    structure_plan: structurePlan,
    ledger,
    match_summary: matchSummary,
    gate_result: gateResult,
    render_contract_preview: ledgerToRenderPackageInputs(ledger),
  };
}

export { createSourceLineIndex } from './source-line-index';
export { planProductRegistrationV3 } from './structure-planner';
export { buildProductRegistrationV3Ledger } from './ledger-builder';
export { applyProductRegistrationV3Matching } from './matcher';
export { evaluateProductRegistrationV3Gate } from './gate';
export { ledgerToRenderPackageInputs } from './render-contract-adapter';
export { persistProductRegistrationDraftV3 } from './persist';
export type {
  V3DraftLedger,
  V3Evidence,
  V3GateResult,
  V3LedgerEvent,
  V3PipelineResult,
  V3SourceLine,
  V3StructurePlan,
} from './types';
