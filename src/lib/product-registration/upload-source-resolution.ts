import type { UploadSourceMetadataResult } from '@/lib/upload-source-metadata';

import { extractUploadDestinationFromFilename } from './destination-resolution';
import {
  parseFilename,
  resolveLandOperatorId,
  resolveSupplierCode,
  type UploadFilenameRule,
  type UploadLandOperatorRow,
} from './upload-supplier-context';

export type UploadSourceResolutionResult = {
  filenameRule: UploadFilenameRule;
  supplierCode: string;
  marginRate: number;
  tempDestination: string;
  prelimLandOperatorId: string | null;
};

export function resolveUploadSourceForRegistration(input: {
  fileName: string;
  uploadSourceMetadata: UploadSourceMetadataResult;
  landOperators: UploadLandOperatorRow[];
}): UploadSourceResolutionResult {
  const parsedFilenameRule = parseFilename(input.fileName);
  const filenameRule = {
    ...parsedFilenameRule,
    supplierRaw: input.uploadSourceMetadata.landOperator ?? parsedFilenameRule.supplierRaw,
    marginRate: input.uploadSourceMetadata.marginRate ?? parsedFilenameRule.marginRate,
    cleanName: input.uploadSourceMetadata.cleanSourceLabel ?? parsedFilenameRule.cleanName,
  };
  const supplierCode = resolveSupplierCode(filenameRule.supplierRaw);
  const marginRate = filenameRule.marginRate ?? 0.10;
  const tempDestination = extractUploadDestinationFromFilename(input.fileName);
  const prelimLandOperatorId = resolveLandOperatorId(filenameRule.supplierRaw, input.landOperators);

  return {
    filenameRule,
    supplierCode,
    marginRate,
    tempDestination,
    prelimLandOperatorId,
  };
}
