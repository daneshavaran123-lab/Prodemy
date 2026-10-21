import type { DepartmentRef, EmployeeRef } from '@karban/shared';

export const employeeRefSelect = {
  id: true,
  fullName: true,
  jobTitle: true,
  departmentId: true,
} as const;

export const departmentRefSelect = { id: true, name: true } as const;

export function toEmployeeRef(
  e: { id: string; fullName: string; jobTitle: string | null; departmentId: string } | null | undefined,
): EmployeeRef | null {
  return e ? { id: e.id, fullName: e.fullName, jobTitle: e.jobTitle, departmentId: e.departmentId } : null;
}

export function toDepartmentRef(d: { id: string; name: string } | null | undefined): DepartmentRef | null {
  return d ? { id: d.id, name: d.name } : null;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
