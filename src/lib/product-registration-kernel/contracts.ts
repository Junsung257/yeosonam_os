import type { ProductRegistrationV6Decision } from '@/lib/product-registration-v6/types';
import type { ProductRegistrationV6PolicyInput } from '@/lib/product-registration-v6/terminal-policy';
import type { SourceSalePriceDisposition } from '@/lib/product-registration-v6/source-sale-price-disposition';

export type KernelFindingSeverity = 'blocker' | 'degraded';
export type KernelFindingResolutionState = 'blocked' | 'degraded' | 'resolved';

/** Stable, role-based validation contract. Legacy V3/V4/V6 validators may
 * produce evidence, but only this finding shape crosses the Kernel boundary. */
export type KernelFinding = {
  fieldPath: string;
  severity: KernelFindingSeverity;
  code: string;
  message: string;
  sourceAnchor: string | null;
  ruleVersion: string;
  resolutionState: KernelFindingResolutionState;
};

export type RegistrationKernelInput = ProductRegistrationV6PolicyInput;

export type CandidateFactGraph = {
  graphHash: string;
  productAxes: unknown[];
  priceCandidates: unknown[];
  commercialClaims: unknown[];
  evidenceEdges: unknown[];
};

export type RevisionAggregate = {
  revisionId: string;
  revisionHash: string;
  canonicalFacts: Record<string, unknown>;
  typedProjectionHash: string;
};

export type PublicationDecision = ProductRegistrationV6Decision & {
  decisionHash: string;
  findings: KernelFinding[];
  sourceSalePriceDispositions: Array<{
    sectionIndex: number;
    disposition: SourceSalePriceDisposition;
  }>;
};
