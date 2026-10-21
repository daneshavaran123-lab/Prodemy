import { Prisma, TaskEventType } from '@prisma/client';
import type { Db } from '../../prisma/prisma.service';

export interface HistoryEntry {
  eventType: TaskEventType;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

const json = (v: unknown) =>
  v === undefined ? undefined : v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);

/**
 * Append-only task history (PRD §32): every record carries actor, timestamp and
 * previous/new value. `actorId` null means a system action (scheduler, recurrence).
 */
export async function recordHistory(
  db: Db,
  taskId: string,
  actorId: string | null,
  entries: HistoryEntry[],
): Promise<void> {
  if (!entries.length) return;
  const now = Date.now();
  await db.taskHistory.createMany({
    // Millisecond offsets keep a stable chronological order within one change.
    data: entries.map((e, i) => ({
      taskId,
      actorId,
      eventType: e.eventType,
      field: e.field ?? null,
      oldValue: json(e.oldValue),
      newValue: json(e.newValue),
      createdAt: new Date(now + i),
    })),
  });
}
