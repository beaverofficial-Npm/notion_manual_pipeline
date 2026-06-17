import { publishTaskToNotion } from '@/lib/notion/publish';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

// 발행 진행 상황을 NDJSON 스트림으로 전송한다(각 페이지 단계 + 최종 결과/에러).
// 클라이언트 연결이 끊기면(취소/새로고침) 발행을 중단하고, 닫힌 스트림에 쓰지 않는다.
export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
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
