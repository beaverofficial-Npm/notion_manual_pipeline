import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// 변환 워커 생존 상태. 워커는 15초마다 worker_heartbeats 에 신호를 남긴다.
// last_seen_at 이 30초 이내면 온라인 — 죽으면 화면에서 바로 보이게 하는 것이 목적.
const ONLINE_WINDOW_MS = 30 * 1000;

export async function GET() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('worker_heartbeats')
    .select('id,version,env_label,last_seen_at,started_at')
    .eq('role', 'conversion')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ online: false, message: error.message }, { status: 200 });
  }
  if (!data) {
    return NextResponse.json({ online: false, worker: null });
  }
  const online = Date.now() - new Date(data.last_seen_at).getTime() < ONLINE_WINDOW_MS;
  return NextResponse.json({ online, worker: data });
}
