export type ManualPart = 'general_summary' | 'detailed_manual' | 'appendix' | 'unknown';
export type AudienceScope = 'common' | 'franchise' | 'general' | 'unknown';
export type AnchorConfidence = 'high' | 'medium' | 'low';

export interface ManualBuilderSource {
  kind: string;
  file_name: string;
  slide_numbers: number[];
  slide_count: number;
}

export interface ManualBuilderTaxonomy {
  manual_part: ManualPart;
  audience_scope: AudienceScope;
  category_title: string;
  normalized_category: string;
  function_title: string;
  normalized_function_title: string;
  chapter_no: string | null;
  is_franchise_only: boolean;
  source_label: string | null;
  audience_prefix: string | null;
}

export interface ManualBuilderUnit {
  unit_id: string;
  stable_key: string;
  product: 'storemgmt';
  source: ManualBuilderSource;
  taxonomy: ManualBuilderTaxonomy;
  content_summary: {
    text_blocks: string[];
    block_count: number;
    image_candidate_count: number;
    table_count: number;
  };
  search: {
    keywords: string[];
    normalized_blob: string;
  };
  pilot: {
    priority: number;
    reason: string;
  } | null;
  evidence: {
    normalization_rules: string[];
    manual_part_inference: string;
    scope_inference: string;
  };
}

export interface AnchorCandidate {
  unit_id: string;
  candidate_id: string;
  candidate_type: string;
  label: string;
  source_ref: string;
  source_id?: string | null;
  url: string | null;
  score: number;
  confidence: AnchorConfidence;
  matched_terms: string[];
  match_reason: string[];
  evidence: Record<string, unknown>;
}

export interface AnchorGroup {
  unit_id: string;
  stable_key: string;
  candidates: AnchorCandidate[];
}

export interface ManualBuilderSummary {
  generatedAt: string;
  product: 'storemgmt';
  sourceFile: string;
  unitCount: number;
  pilotCount: number;
  franchiseCount: number;
  realmeasureScreenCount: number;
  anchoredUnitCount: number;
  pilotAnchoredCount: number;
  kmsStatus: string;
  kmsReason: string | null;
}

export interface ManualBuilderUnitView extends ManualBuilderUnit {
  anchor_group: AnchorGroup;
}

export interface ManualBuilderDataset {
  summary: ManualBuilderSummary;
  units: ManualBuilderUnitView[];
}
