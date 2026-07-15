import { publishTaskToNotion } from '@/lib/notion/publish';
import { extractNotionPageId } from '@/lib/notion/publish';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

// 발행 진행 상황을 NDJSON 스트림으로 전송한다(각 페이지 단계 + 최종 결과/에러).
// 클라이언트 연결이 끊기면(취소/새로고침) 발행을 중단하고, 닫힌 스트림에 쓰지 않는다.
export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const supabase = createServiceSupabaseClient();

  // 요청 본문에서 Notion 링크 받기
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const notionLink = typeof body.notionTarget === 'string' ? body.notionTarget.trim() : '';

  // Notion 링크에서 page id 추출
  const pageId = extractNotionPageId(notionLink);
  if (!pageId) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Notion 페이지 URL 또는 ID가 올바르지 않습니다. 링크를 다시 확인해 주세요.' }) + '\n',
      {
        status: 400,
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
      }
    );
  }

  // task에 target_notion_page_id 설정
  const { error: updateError } = await supabase
    .from('manual_tasks')
    .update({ target_notion_page_id: pageId, updated_at: new Date().toISOString() })
    .eq('id', taskId);

  if (updateError) {
    return new Response(
      JSON.stringify({ type: 'error', message: updateError.message }) + '\n',
      {
        status: 500,
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
      }
    );
  }

  // 중복 발행 방어: 이 작업에 이미 진행 중(running)인 발행이 있으면 새로 시작하지 않는다.
  // (팝업이 실패처럼 닫혀 재클릭이 반복되면 발행이 겹쳐 서버가 터졌음.)
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: activeRun } = await supabase
    .from('manual_publish_runs')
    .select('id,started_at')
    .eq('task_id', taskId)
    .eq('status', 'running')
    .gt('started_at', staleCutoff)
    .limit(1)
    .maybeSingle();
  if (activeRun) {
    return new Response(
      JSON.stringify({ type: 'error', message: '이미 발행이 진행 중입니다. 잠시만 기다려 주세요.' }) + '\n',
      { status: 409, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } },
    );
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
          abort.abort();
        }
      };
      try {
        const result = await publishTaskToNotion(taskId, (progress) => send({ type: 'progress', progress }), abort.signal);
        send({ type: 'done', result });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : 'Notion 발행에 실패했습니다.' });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // 이미 닫힘
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
