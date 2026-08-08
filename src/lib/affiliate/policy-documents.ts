import { hashOpaqueValue } from "@/lib/affiliate/auth-crypto";
import { AFFILIATE_TERMS_BUNDLE_VERSION } from "@/lib/affiliate/application-contract";

export const AFFILIATE_REQUIRED_DOCUMENTS = [
  "AFFILIATE_AGREEMENT",
  "PRIVACY",
  "AD_DISCLOSURE",
  "PAYOUT_POLICY",
] as const;

export type AffiliateRequiredDocument =
  (typeof AFFILIATE_REQUIRED_DOCUMENTS)[number];

export function affiliateDocumentVersion(
  _documentType: AffiliateRequiredDocument,
): string {
  return AFFILIATE_TERMS_BUNDLE_VERSION;
}

/**
 * The hash is a stable contract identifier until the legal document registry
 * is introduced. It prevents a client from choosing a version/hash pair.
 * Production legal publishing must replace this with the canonical document
 * bytes hash and keep the version unchanged for an immutable acceptance row.
 */
export function affiliateDocumentHash(
  documentType: AffiliateRequiredDocument,
): string {
  return hashOpaqueValue(
    `affiliate-document:${documentType}:${affiliateDocumentVersion(documentType)}`,
  );
}
