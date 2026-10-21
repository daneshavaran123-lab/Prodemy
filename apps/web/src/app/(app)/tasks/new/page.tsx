'use client';

import { PageHeader } from '@/components/ui/layout';
import { TaskForm } from '@/components/tasks/task-form';

export default function NewTaskPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="وظیفه جدید" description="هر وظیفه یک مسئول اصلی، مهلت و اولویت مشخص دارد." />
      <TaskForm />
    </div>
  );
}
