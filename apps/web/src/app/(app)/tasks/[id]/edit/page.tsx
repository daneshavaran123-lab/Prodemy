'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { TaskDetail } from '@karban/shared';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/layout';
import { TaskForm } from '@/components/tasks/task-form';
import { errorMessage, get } from '@/lib/api';

export default function EditTaskPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['task', id], queryFn: () => get<TaskDetail>(`/tasks/${id}`) });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="ویرایش وظیفه" description={q.data ? `${q.data.code} — ${q.data.title}` : undefined} />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} />}
      {q.data && !q.data.permissions.canEdit && <ErrorState message="شما مجاز به ویرایش این وظیفه نیستید." />}
      {q.data?.permissions.canEdit && <TaskForm key={q.data.version} task={q.data} />}
    </div>
  );
}
