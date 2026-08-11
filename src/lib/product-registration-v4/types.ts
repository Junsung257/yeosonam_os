import type { SupabaseClient } from '@supabase/supabase-js';

export const PRODUCT_REGISTRATION_V4_PARSER_ENGINE = 'rhwp';
export const PRODUCT_REGISTRATION_V4_PARSER_VERSION = '0.8.2';
export const PRODUCT_REGISTRATION_V4_MAX_BYTES = 50 * 1024 * 1024;

export type ProductSourceType = 'text' | 'pdf' | 'image' | 'hwp' | 'hwpx';

export type ProductSourceStatus = 'stored' | 'scanning' | 'ready' | 'quarantined' | 'deleted';

export type ProductRegistrationV4Stage =
  | 'uploaded'
  | 'preflight'
  | 'extracted'
  | 'segmented'
  | 'normalized'
  | 'verified'
  | 'proofed'
  | 'published'
  | 'needs_review'
  | 'failed'
  | 'quarantined';

export type ProductRegistrationV4JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export type EvidenceRef = {
  documentId: string;
  extractionId?: string;
  nodeId: string;
  page?: number;
  table?: {
    id: string;
    row: number;
    column: number;
    rowSpan?: number;
    colSpan?: number;
  };
  quoteHash: string;
};

export type DocumentIrNodeKind = 'page' | 'paragraph' | 'table' | 'cell' | 'image' | 'line_break';

export type DocumentIrNode = {
  id: string;
  kind: DocumentIrNodeKind;
  text?: string;
  page?: number;
  parentId?: string;
  order: number;
  attributes?: Record<string, unknown>;
};

export type DocumentIrTableCell = {
  id: string;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  nodeId: string;
  evidence: {
    page?: number;
    quoteHash: string;
  };
};

export type DocumentIrTable = {
  id: string;
  page?: number;
  rows: number;
  columns: number;
  cells: DocumentIrTableCell[];
};

export type DocumentIR = {
  version: 'v4';
  filename: string;
  sourceType: ProductSourceType;
  pages: number;
  text: string;
  nodes: DocumentIrNode[];
  tables: DocumentIrTable[];
  assets: Array<{ id: string; kind: 'image' | 'svg' | 'pdf'; nodeId?: string; metadata?: Record<string, unknown> }>;
  parser: {
    engine: string;
    version: string;
    checksum?: string;
  };
};

export type SourceDocumentRecord = {
  id: string;
  original_filename: string;
  storage_bucket: string;
  storage_path: string;
  sha256: string;
  byte_size: number;
  declared_mime: string | null;
  detected_mime: string | null;
  source_type: ProductSourceType;
  status: ProductSourceStatus;
  security_scan: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tenant_id: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductRegistrationV4JobRecord = {
  id: string;
  tenant_id: string;
  source_type: 'text' | 'file';
  status: ProductRegistrationV4JobStatus;
  source_document_id: string | null;
  extraction_id: string | null;
  v4_stage: ProductRegistrationV4Stage;
  v4_attempt_count: number;
  v4_lease_expires_at: string | null;
  v4_canonical_normalization_id: string | null;
  v4_parser_engine: string | null;
  v4_parser_version: string | null;
  v4_stage_state: Record<string, unknown>;
  v4_review_reasons: string[];
  v4_last_error_code: string | null;
  v4_last_error_detail: string | null;
  v6_workflow_run_id?: string | null;
  v6_outcome?: 'published_verified' | 'published_degraded' | 'blocked_action_required' | null;
  v6_policy_version?: string | null;
  v6_last_heartbeat_at?: string | null;
  v6_terminal_at?: string | null;
  v6_degraded_reasons?: string[];
  v6_blockers?: string[];
  v6_external_cost_krw?: number;
  v6_fencing_token?: number;
  created_at: string;
  updated_at: string;
};

export type ProductRegistrationV4DbClient = SupabaseClient;
