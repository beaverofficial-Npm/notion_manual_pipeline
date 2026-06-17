import { PipelineDashboard } from '@/components/pipeline-dashboard';
import { listManualProjects } from '@/lib/pipeline/tasks';
import type { ManualProject } from '@/types/pipeline';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // 환경변수 누락이나 일시적 DB 오류로 페이지 전체가 죽지 않도록 방어한다.
  let projects: ManualProject[] = [];
  try {
    projects = await listManualProjects();
  } catch (error) {
    console.error('변환 목록을 불러오지 못했습니다.', error);
  }

  return <PipelineDashboard projects={projects} />;
}
