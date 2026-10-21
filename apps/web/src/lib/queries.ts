'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiStatus,
  DepartmentDto,
  DirectoryEmployee,
  ProjectDto,
  SessionUser,
  SystemSettings,
  TeamDto,
} from '@karban/shared';
import { get } from './api';

export const qk = {
  me: ['me'] as const,
  directory: ['directory'] as const,
  departments: ['departments'] as const,
  teams: (departmentId?: string) => ['teams', departmentId ?? 'all'] as const,
  projects: ['projects'] as const,
  settings: ['settings'] as const,
  unread: ['notifications', 'unread'] as const,
  aiStatus: ['ai', 'status'] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => get<SessionUser>('/auth/me'), retry: false, staleTime: 60_000 });
}

/** Current user; only call under the authenticated layout. */
export function useSession(): SessionUser {
  const { data } = useMe();
  if (!data) throw new Error('useSession() used outside the authenticated layout');
  return data;
}

export function useCan() {
  const { data } = useMe();
  return (permission: string) => !!data?.permissions.includes(permission);
}

export function useDirectory() {
  return useQuery({
    queryKey: qk.directory,
    queryFn: () => get<DirectoryEmployee[]>('/employees/directory'),
    staleTime: 5 * 60_000,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: qk.departments,
    queryFn: () => get<DepartmentDto[]>('/departments'),
    staleTime: 5 * 60_000,
  });
}

export function useTeams(departmentId?: string) {
  return useQuery({
    queryKey: qk.teams(departmentId),
    queryFn: () => get<TeamDto[]>('/teams', { departmentId }),
    staleTime: 5 * 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: () => get<ProjectDto[]>('/projects', { status: 'ACTIVE' }),
    staleTime: 5 * 60_000,
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => get<SystemSettings>('/settings'), staleTime: 5 * 60_000 });
}

export function useAiStatus() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: qk.aiStatus,
    queryFn: () => get<AiStatus>('/ai/status'),
    enabled: !!me?.permissions.includes('ai.use'),
    staleTime: 60_000,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: qk.unread,
    queryFn: () => get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Invalidate everything task-related after a mutation (lists, dashboards, detail). */
export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['tasks'] }),
      qc.invalidateQueries({ queryKey: ['task'] }),
      qc.invalidateQueries({ queryKey: ['timeline'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['ai', 'summary'] }),
    ]);
}
