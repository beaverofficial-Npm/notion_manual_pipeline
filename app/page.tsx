import { PipelineDashboard } from '@/components/pipeline-dashboard';
import { listManualProjects } from '@/lib/pipeline/tasks';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const projects = await listManualProjects();

  return <PipelineDashboard projects={projects} />;
}
