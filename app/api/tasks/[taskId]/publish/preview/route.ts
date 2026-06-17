import { NextResponse } from 'next/server';
import { buildPublishPreview } from '@/lib/notion/publish';

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const preview = await buildPublishPreview(taskId);
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Notion 미리보기를 생성하지 못했습니다.' },
      { status: 500 },
    );
  }
}
