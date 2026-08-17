import { getDocumentIRValidationErrors, sha256Hex } from './document-ir';
import type { DocumentIR, DocumentIrNode, DocumentIrTable } from './types';

export type SourceBundleDocumentIRMember = {
  sourceDocumentId: string;
  extractionId: string;
  sourceHash: string;
  role: 'price_sheet' | 'itinerary_sheet' | 'terms_sheet';
  documentIr: DocumentIR;
};

const ROLE_ORDER: Record<SourceBundleDocumentIRMember['role'], number> = {
  price_sheet: 0,
  itinerary_sheet: 1,
  terms_sheet: 2,
};

function namespace(value: string, sourceHash: string): string {
  return `bundle-${sourceHash.slice(0, 12)}-${value}`;
}

/**
 * Creates one parser input from an already approved complementary-source
 * bundle. Every node keeps the originating document/extraction/hash so claim
 * evidence can never be reassigned to the primary source document.
 */
export function mergeSourceBundleDocumentIR(input: {
  bundleHash: string;
  members: SourceBundleDocumentIRMember[];
}): DocumentIR {
  if (!/^[0-9a-f]{64}$/u.test(input.bundleHash)) throw new Error('SOURCE_BUNDLE_HASH_INVALID');
  if (input.members.length < 2) throw new Error('SOURCE_BUNDLE_MEMBER_COUNT_INVALID');
  const roles = new Set(input.members.map(member => member.role));
  if (!roles.has('price_sheet') || !roles.has('itinerary_sheet')) {
    throw new Error('SOURCE_BUNDLE_COMPLEMENTARY_ROLES_REQUIRED');
  }
  const sourceIds = new Set<string>();
  const sourceHashes = new Set<string>();
  for (const member of input.members) {
    const errors = getDocumentIRValidationErrors(member.documentIr);
    if (errors.length > 0) throw new Error(`SOURCE_BUNDLE_DOCUMENT_IR_INVALID:${errors.join(',')}`);
    if (!/^[0-9a-f]{64}$/u.test(member.sourceHash)) throw new Error('SOURCE_BUNDLE_SOURCE_HASH_INVALID');
    if (sourceIds.has(member.sourceDocumentId) || sourceHashes.has(member.sourceHash)) {
      throw new Error('SOURCE_BUNDLE_DUPLICATE_MEMBER');
    }
    sourceIds.add(member.sourceDocumentId);
    sourceHashes.add(member.sourceHash);
  }

  const members = [...input.members].sort((left, right) => (
    ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
    || left.sourceHash.localeCompare(right.sourceHash)
  ));
  const nodes: DocumentIrNode[] = [];
  const tables: DocumentIrTable[] = [];
  const assets: DocumentIR['assets'] = [];
  const texts: string[] = [];
  let pageOffset = 0;
  let order = 0;

  for (const member of members) {
    const prefix = member.sourceHash;
    const sourceAttributes = {
      sourceDocumentId: member.sourceDocumentId,
      extractionId: member.extractionId,
      sourceHash: member.sourceHash,
      sourceRole: member.role,
    };
    const nodeIds = new Map(member.documentIr.nodes.map(node => [node.id, namespace(node.id, prefix)]));
    for (const node of member.documentIr.nodes) {
      nodes.push({
        ...node,
        id: nodeIds.get(node.id)!,
        parentId: node.parentId ? nodeIds.get(node.parentId) ?? namespace(node.parentId, prefix) : undefined,
        page: typeof node.page === 'number' ? node.page + pageOffset : undefined,
        order: order++,
        attributes: { ...(node.attributes ?? {}), ...sourceAttributes, originalNodeId: node.id },
      });
    }
    for (const table of member.documentIr.tables) {
      const tableId = namespace(table.id, prefix);
      tables.push({
        ...table,
        id: tableId,
        page: typeof table.page === 'number' ? table.page + pageOffset : undefined,
        cells: table.cells.map(cell => ({
          ...cell,
          id: namespace(cell.id, prefix),
          nodeId: nodeIds.get(cell.nodeId) ?? namespace(cell.nodeId, prefix),
          evidence: {
            ...cell.evidence,
            page: typeof cell.evidence.page === 'number' ? cell.evidence.page + pageOffset : undefined,
          },
        })),
      });
    }
    for (const asset of member.documentIr.assets) {
      assets.push({
        ...asset,
        id: namespace(asset.id, prefix),
        nodeId: asset.nodeId ? nodeIds.get(asset.nodeId) ?? namespace(asset.nodeId, prefix) : undefined,
        metadata: { ...(asset.metadata ?? {}), ...sourceAttributes },
      });
    }
    texts.push(member.documentIr.text.trim());
    pageOffset += Math.max(1, member.documentIr.pages);
  }

  return {
    version: 'v4',
    filename: `source-bundle-${input.bundleHash}.hwp`,
    sourceType: members.every(member => member.documentIr.sourceType === 'hwp') ? 'hwp' : 'text',
    pages: Math.max(1, pageOffset),
    text: texts.filter(Boolean).join('\n\n---\n\n'),
    nodes,
    tables,
    assets: [{
      id: `source-bundle-${input.bundleHash}`,
      kind: 'manifest',
      metadata: {
        bundleHash: input.bundleHash,
        memberCount: members.length,
        memberManifestHash: sha256Hex(JSON.stringify(members.map(member => ({
          sourceDocumentId: member.sourceDocumentId,
          extractionId: member.extractionId,
          sourceHash: member.sourceHash,
          role: member.role,
          filename: member.documentIr.filename,
        })))),
        memberFilenames: members.map(member => member.documentIr.filename),
      },
    }, ...assets],
    parser: {
      engine: 'source-bundle-evidence-ir',
      version: '2026-08-13.2',
      checksum: input.bundleHash,
    },
  };
}
