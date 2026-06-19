import { NextResponse } from 'next/server';
import { getStoreMgmtManualBuilderDataset } from '@/lib/manual-builder/storemgmt';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getStoreMgmtManualBuilderDataset());
}
