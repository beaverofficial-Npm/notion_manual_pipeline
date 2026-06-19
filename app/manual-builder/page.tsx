import { ManualBuilderWorkspace } from '@/components/manual-builder-workspace';
import { getStoreMgmtManualBuilderDataset } from '@/lib/manual-builder/storemgmt';

export const dynamic = 'force-dynamic';

export default function ManualBuilderPage() {
  const dataset = getStoreMgmtManualBuilderDataset();

  return <ManualBuilderWorkspace dataset={dataset} />;
}
