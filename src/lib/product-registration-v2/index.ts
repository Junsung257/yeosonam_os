import { planProductRegistrationV2 } from './structure-planner';
import { executeProductRegistrationV2 } from './parser-executor';
import { evaluateProductRegistrationV2Gate } from './render-qa-gate';
import type { ProductRegistrationV2Result } from './types';

export async function runProductRegistrationV2(rawText: string): Promise<ProductRegistrationV2Result> {
  const plan = planProductRegistrationV2(rawText);
  const products = await executeProductRegistrationV2(rawText, plan);
  const gate = evaluateProductRegistrationV2Gate(plan, products);
  return { plan, products, gate };
}

export { planProductRegistrationV2 } from './structure-planner';
export { executeProductRegistrationV2 } from './parser-executor';
export { evaluateProductRegistrationV2Gate } from './render-qa-gate';
export { extractCustomerAttractionCandidatesV2 } from './attraction-candidates';
export type {
  ProductRegistrationV2Boundary,
  ProductRegistrationV2ExecutedProduct,
  ProductRegistrationV2GateCheck,
  ProductRegistrationV2GateResult,
  ProductRegistrationV2Plan,
  ProductRegistrationV2Result,
} from './types';
