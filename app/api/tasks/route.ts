import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getManualProject, listManualProjects } from '@/lib/pipeline/tasks';
import { createSourceUploadUrl } from '@/lib/storage/source-storage';

const PPTX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function isPptName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.ppt') || lower.endsWith('.pptx');
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

// 원본 PPT 업로드는 presigned 직접 업로드 방식이다.
// 서버는 파일 바이트를 받지 않고 (1) task/source 레코드를 만든 뒤 (2) R2 presigned PUT URL 만 발급한다.
// 브라우저가 그 URL 로 R2 에 직접 올리고 나서 /run 을 호출한다.
// → 서버가 큰 파일을 메모리에 받지 않으므로 50MB 한도·서버 부하·업로드 타임아웃(fetch failed)에서 자유롭다.
export async function POST(request: Request) {
  const supabase = createServiceSupabaseClient();

  try {
    const body = (await request.json().catch(() => ({}))) as { fileName?: unknown; fileSize?: unknown };

    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    if (!fileName || !isPptName(fileName)) {
      return NextResponse.json({ message: 'PPT 또는 PPTX 파일명이 필요합니다.' }, { status: 400 });
    }

    const fileSize = typeof body.fileSize === 'number' && Number.isFinite(body.fileSize) && body.fileSize > 0 ? body.fileSize : null;
    const title = fileNameToTitle(fileName);

    const { data: task, error: taskError } = await supabase
      .from('manual_tasks')
      .insert({
        title,
        status: 'ready',
        target_notion_page_id: null,
        publish_mode: 'create_child',
        // 변환 방식은 고정 영역 캡처 단일 경로다. 요청값으로 구방식을 선택할 수 없게 서버에서 고정한다.
        conversion_mode: 'group_bake',
      })
      .select('id')
      .single();

    if (taskError || !task) {
      return NextResponse.json({ message: taskError?.message ?? '작업을 생성하지 못했습니다.' }, { status: 500 });
    }

    const storagePath = `${task.id}/source/${Date.now()}-${safeFileName(fileName)}`;

    const { error: sourceError } = await supabase.from('manual_source_files').insert({
      task_id: task.id,
      file_name: fileName,
      storage_path: storagePath,
      file_size: fileSize,
    });

    if (sourceError) {
      await supabase.from('manual_tasks').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', task.id);
      return NextResponse.json({ message: sourceError.message }, { status: 500 });
    }

    let uploadUrl: string;
    try {
      uploadUrl = await createSourceUploadUrl(storagePath, PPTX_CONTENT_TYPE);
    } catch (urlError) {
      await supabase.from('manual_tasks').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', task.id);
      return NextResponse.json(
        { message: urlError instanceof Error ? urlError.message : '업로드 URL 발급에 실패했습니다.' },
        { status: 500 },
      );
    }

    const project = await getManualProject(task.id);

    return NextResponse.json({ project, uploadUrl, contentType: PPTX_CONTENT_TYPE }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : '작업을 생성하지 못했습니다.' },
      { status: 500 },
    );
  }
}
