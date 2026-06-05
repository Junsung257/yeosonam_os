import { extractPriceIR } from './price-ir';
import type {
  MatrixPriceRow,
  PriceIROptions,
  PriceIRResult,
  PriceIRSource,
  PriceTier,
} from './price-ir/types';

export type DeterministicPriceSource = PriceIRSource;
export interface DeterministicPriceOptions extends PriceIROptions {}
export interface DeterministicPriceResult extends PriceIRResult {}

export function extractDeterministicPriceTiers(
  rawText: string,
  options: DeterministicPriceOptions = {},
): DeterministicPriceResult {
  return extractPriceIR(rawText, options);
}

export type { MatrixPriceRow, PriceTier };
