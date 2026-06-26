import { TaskReviewGallery } from '@/components/task-review-gallery';
import { TaskReviewBake } from '@/components/task-review-bake';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  params: Promise<{
    taskId: string;
  }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { taskId } = await params;

  // task의 conversion_mode 확인
  const supabase = createServiceSupabaseClient();
  const { data: task } = await supabase
    .from('manual_tasks')
    .select('conversion_mode')
    .eq('id', taskId)
    .single();

  const conversionMode = task?.conversion_mode ?? 'capture';

  // 모드에 따라 컴포넌트 분기
  if (conversionMode === 'group_bake') {
    return <TaskReviewBake taskId={taskId} />;
  }

  // 기본값(capture 모드)
  return <TaskReviewGallery taskId={taskId} />;
}
