import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getManualProject, listManualProjects } from '@/lib/pipeline/tasks';

const SOURCE_BUCKET = 'manual-source';

function isPptFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith('.ppt') || name.endsWith('.pptx');
}

function fileNameToTitle(fileName: string) {
  return fileName.replace(/\.(pptx|ppt)$/i, '').trim() || '새 변환 작업';
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-가-힣 ()]/g, '_');
}

export async function GET() {
  try {
    const projects = await listManualProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : '작업 목록을 불러오지 못했습니다.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supabase = createServiceSupabaseClient();

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const titleValue = formData.get('title');
    const modeValue = formData.get('mode');

    if (!(file instanceof File)) {
      return NextResponse.json({ message: 'PPT 파일이 필요합니다.' }, { status: 400 });
    }

    if (!isPptFile(file)) {
      return NextResponse.json({ message: 'PPT 또는 PPTX 파일만 업로드할 수 있습니다.' }, { status: 400 });
    }

    const title = typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : fileNameToTitle(file.name);
    // mode 검증: 미지정 시 기본값 'group_bake'(자동 추출 단일 — 레거시 캡쳐는 웹에서 제거, 값은 기존 호환용으로만 허용)
    const mode = typeof modeValue === 'string' && modeValue.trim() ? modeValue.trim() : 'group_bake';
    if (!['capture', 'group_bake'].includes(mode)) {
      return NextResponse.json({ message: 'mode은 capture 또는 group_bake이어야 합니다.' }, { status: 400 });
    }

    const { data: task, error: taskError } = await supabase
      .from('manual_tasks')
      .insert({
        title,
        status: 'ready',
        target_notion_page_id: null,
        publish_mode: 'create_child',
        conversion_mode: mode,
      })
      .select('id')
      .single();

    if (taskError || !task) {
      return NextResponse.json({ message: taskError?.message ?? '작업을 생성하지 못했습니다.' }, { status: 500 });
    }

    const storagePath = `${task.id}/source/${Date.now()}-${safeFileName(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage.from(SOURCE_BUCKET).upload(storagePath, buffer, {
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      upsert: false,
    });

    if (uploadError) {
      await supabase.from('manual_tasks').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', task.id);
      return NextResponse.json({ message: uploadError.message }, { status: 500 });
    }

    const { error: sourceError } = await supabase.from('manual_source_files').insert({
      task_id: task.id,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
    });

    if (sourceError) {
      await supabase.from('manual_tasks').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', task.id);
      return NextResponse.json({ message: sourceError.message }, { status: 500 });
    }

    const project = await getManualProject(task.id);

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : '작업을 생성하지 못했습니다.' },
      { status: 500 },
    );
  }
}
