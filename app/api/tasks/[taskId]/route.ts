import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === 'string' && body.title.trim()) {
    updates.title = body.title.trim();
  }
  if (typeof body.target_notion_page_id === 'string') {
    updates.target_notion_page_id = body.target_notion_page_id.trim() || null;
  }

  const { data, error } = await supabase
    .from('manual_tasks')
    .update(updates)
    .eq('id', taskId)
    .select('id,title,target_notion_page_id')
    .single();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? '작업을 수정하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ task: data });
}

async function removeStoragePaths(bucket: string, paths: string[]) {
  if (paths.length === 0) return;

  const supabase = createServiceSupabaseClient();
  for (let index = 0; index < paths.length; index += 100) {
    const chunk = paths.slice(index, index + 100);
    await supabase.storage.from(bucket).remove(chunk);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  try {
    const { data: task, error: taskError } = await supabase.from('manual_tasks').select('id,status').eq('id', taskId).single();

    if (taskError || !task) {
      return NextResponse.json({ message: taskError?.message ?? '작업을 찾지 못했습니다.' }, { status: 404 });
    }

    if (task.status === 'running' || task.status === 'publishing') {
      const label = task.status === 'running' ? '분석' : '추출';
      return NextResponse.json({ message: `${label} 중인 작업은 삭제할 수 없습니다.` }, { status: 409 });
    }

    const [{ data: sources }, { data: slides }, { data: jobs }] = await Promise.all([
      supabase.from('manual_source_files').select('storage_path').eq('task_id', taskId),
      supabase.from('manual_slides').select('id,render_path').eq('task_id', taskId),
      supabase.from('manual_conversion_jobs').select('manifest_path').eq('task_id', taskId),
    ]);

    const slideRows = slides ?? [];
    const slideIds = slideRows.map((slide) => slide.id);
    let assetPaths: string[] = [];

    if (slideIds.length > 0) {
      const { data: assets } = await supabase.from('manual_assets').select('storage_path').in('slide_id', slideIds);
      assetPaths = (assets ?? []).map((asset) => asset.storage_path).filter(Boolean) as string[];
    }

    await Promise.all([
      removeStoragePaths(
        'manual-source',
        (sources ?? []).map((source) => source.storage_path).filter(Boolean) as string[],
      ),
      removeStoragePaths(
        'manual-renders',
        slideRows.map((slide) => slide.render_path).filter(Boolean) as string[],
      ),
      removeStoragePaths('manual-assets', assetPaths),
      removeStoragePaths(
        'manual-manifests',
        (jobs ?? []).map((job) => job.manifest_path).filter(Boolean) as string[],
      ),
    ]);

    const { error: deleteError } = await supabase.from('manual_tasks').delete().eq('id', taskId);

    if (deleteError) {
      return NextResponse.json({ message: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ id: taskId });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : '작업을 삭제하지 못했습니다.' },
      { status: 500 },
    );
  }
}
