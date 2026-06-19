import 'server-only';
import anchorCandidates from '@/data/manual-builder/storemgmt_anchor_candidates.json';
import normalizedManualUnits from '@/data/manual-builder/storemgmt_normalized_manual_units.json';
import type { AnchorGroup, ManualBuilderDataset, ManualBuilderUnit } from '@/types/manual-builder';

interface NormalizedPayload {
  generated_at: string;
  product: 'storemgmt';
  source: {
    file_name: string;
  };
  summary: {
    manual_unit_count: number;
    pilot_count: number;
    franchise_count: number;
  };
  manual_units: ManualBuilderUnit[];
}

interface AnchorPayload {
  generated_at: string;
  summary: {
    realmeasure_screen_count: number;
    anchored_unit_count: number;
    pilot_anchored_count: number;
    kms_status: string;
    kms_reason: string | null;
  };
  kms: {
    status: string;
    reason: string | null;
  };
  anchor_groups: AnchorGroup[];
}

const unitsPayload = normalizedManualUnits as NormalizedPayload;
const anchorsPayload = anchorCandidates as AnchorPayload;

export function getStoreMgmtManualBuilderDataset(): ManualBuilderDataset {
  const anchorsByUnitId = new Map(anchorsPayload.anchor_groups.map((group) => [group.unit_id, group]));

  const units = unitsPayload.manual_units.map((unit) => ({
    ...unit,
    anchor_group: anchorsByUnitId.get(unit.unit_id) ?? {
      unit_id: unit.unit_id,
      stable_key: unit.stable_key,
      candidates: [],
    },
  }));

  return {
    summary: {
      generatedAt: anchorsPayload.generated_at || unitsPayload.generated_at,
      product: 'storemgmt',
      sourceFile: unitsPayload.source.file_name,
      unitCount: unitsPayload.summary.manual_unit_count,
      pilotCount: unitsPayload.summary.pilot_count,
      franchiseCount: unitsPayload.summary.franchise_count,
      realmeasureScreenCount: anchorsPayload.summary.realmeasure_screen_count,
      anchoredUnitCount: anchorsPayload.summary.anchored_unit_count,
      pilotAnchoredCount: anchorsPayload.summary.pilot_anchored_count,
      kmsStatus: anchorsPayload.kms?.status ?? anchorsPayload.summary.kms_status,
      kmsReason: anchorsPayload.kms?.reason ?? anchorsPayload.summary.kms_reason,
    },
    units,
  };
}
