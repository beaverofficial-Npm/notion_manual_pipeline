import { TaskReviewBake } from '@/components/task-review-bake';

export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  params: Promise<{
    taskId: string;
  }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { taskId } = await params;
  return <TaskReviewBake taskId={taskId} />;
}
