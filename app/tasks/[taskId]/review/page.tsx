import { TaskReviewGallery } from '@/components/task-review-gallery';

export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  params: Promise<{
    taskId: string;
  }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { taskId } = await params;

  return <TaskReviewGallery taskId={taskId} />;
}
