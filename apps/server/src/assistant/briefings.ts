import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { ChiefOfStaffBriefing, EvidenceRef, ProactiveInsight } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { commitments, events, goals, knowledgeRecords, learnedStats, proactiveInsights, tasks } from '../db/schema.js';
import { getSettings } from '../settings.js';
import { nowUtcIso } from '../config.js';
import { evidenceByIds, upsertKnowledgeRecord } from './foundation.js';

function evidence(db: DB, ids: string[]): EvidenceRef[] {
  return evidenceByIds(db, [...new Set(ids)]);
}

function inQuietHours(now: DateTime, start: string, end: string): boolean {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const current = now.hour * 60 + now.minute;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return startMin <= endMin ? current >= startMin && current < endMin : current >= startMin || current < endMin;
}

export function buildDailyBriefing(db: DB, date?: string): ChiefOfStaffBriefing {
  const settings = getSettings(db);
  const local = date ? DateTime.fromISO(date, { zone: settings.timezone }) : DateTime.now().setZone(settings.timezone);
  const day = local.toISODate()!;
  const start = local.startOf('day').toUTC().toISO()!;
  const end = local.endOf('day').toUTC().toISO()!;
  const openTasks = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.isDeleted, 0), inArray(tasks.status, ['todo', 'in_progress'])))
    .all()
    .filter((task) => !task.dueDate || task.dueDate <= day)
    .sort((a, b) => b.priority - a.priority || String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')))
    .slice(0, 6);
  const dayEvents = db
    .select()
    .from(events)
    .all()
    .filter((event) => event.startUtc <= end && event.endUtc >= start)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const waiting = db
    .select()
    .from(commitments)
    .where(inArray(commitments.status, ['open', 'waiting']))
    .all()
    .filter((commitment) => !commitment.dueAtUtc || commitment.dueAtUtc.slice(0, 10) <= day)
    .slice(0, 6);
  const activeGoals = db.select().from(goals).where(eq(goals.status, 'active')).all().slice(0, 4);

  const citationIds = [
    ...openTasks.map((task) => `task:${task.id}`),
    ...dayEvents.map((event) => `calendar:${event.id}`),
    ...waiting.flatMap((item) => {
      try {
        return JSON.parse(item.evidenceIds) as string[];
      } catch {
        return [];
      }
    }),
    ...activeGoals.map((goal) => `goal:${goal.id}`),
  ];
  const citations = evidence(db, citationIds);
  const riskCount = openTasks.filter((task) => !!task.dueDate && task.dueDate < day).length;
  return {
    kind: 'daily',
    title: `Command brief · ${local.toFormat('ccc, LLL d')}`,
    generatedAt: nowUtcIso(),
    summary:
      riskCount > 0
        ? `${riskCount} overdue item${riskCount === 1 ? '' : 's'} need attention. You have ${dayEvents.length} calendar event${dayEvents.length === 1 ? '' : 's'} today.`
        : `${openTasks.length} priority item${openTasks.length === 1 ? '' : 's'} and ${dayEvents.length} calendar event${dayEvents.length === 1 ? '' : 's'} are in view.`,
    sections: [
      {
        title: 'Priorities',
        items: openTasks.map((task) => ({ text: `${task.content}${task.dueDate ? ` · due ${task.dueDate}` : ''}`, citationIds: [`task:${task.id}`] })),
      },
      {
        title: 'Calendar',
        items: dayEvents.map((event) => ({
          text: `${DateTime.fromISO(event.startUtc).setZone(settings.timezone).toFormat('HH:mm')} · ${event.title}`,
          citationIds: [`calendar:${event.id}`],
        })),
      },
      {
        title: 'Waiting commitments',
        items: waiting.map((item) => ({
          text: `${item.title}${item.dueAtUtc ? ` · due ${DateTime.fromISO(item.dueAtUtc).setZone(settings.timezone).toFormat('LLL d')}` : ''}`,
          citationIds: JSON.parse(item.evidenceIds || '[]') as string[],
        })),
      },
      {
        title: 'Goals in view',
        items: activeGoals.map((goal) => ({ text: goal.title, citationIds: [`goal:${goal.id}`] })),
      },
    ].filter((section) => section.items.length),
    citations,
    proposedActions: [],
  };
}

export function buildWeeklyBriefing(db: DB, weekStart?: string): ChiefOfStaffBriefing {
  const settings = getSettings(db);
  const local = weekStart ? DateTime.fromISO(weekStart, { zone: settings.timezone }) : DateTime.now().setZone(settings.timezone).startOf('week');
  const start = local.toISODate()!;
  const end = local.plus({ days: 6 }).toISODate()!;
  const completed = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.isDeleted, 0), eq(tasks.status, 'done')))
    .all()
    .filter((task) => !!task.completedAtUtc && task.completedAtUtc.slice(0, 10) >= start && task.completedAtUtc.slice(0, 10) <= end);
  const delayed = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.isDeleted, 0), inArray(tasks.status, ['todo', 'in_progress'])))
    .all()
    .filter((task) => !!task.dueDate && task.dueDate <= end);
  const activeGoals = db.select().from(goals).where(eq(goals.status, 'active')).all();
  const goalProjects = new Set(activeGoals.map((goal) => goal.linkValue).filter(Boolean));
  const offGoalWork = completed.filter((task) => task.projectId && goalProjects.size > 0 && !goalProjects.has(task.projectId));
  const citationIds = [
    ...completed.map((task) => `task:${task.id}`),
    ...delayed.map((task) => `task:${task.id}`),
    ...activeGoals.map((goal) => `goal:${goal.id}`),
  ];
  return {
    kind: 'weekly',
    title: `Chief-of-staff review · ${local.toFormat('LLL d')}`,
    generatedAt: nowUtcIso(),
    summary: `${completed.length} completed, ${delayed.length} still open${offGoalWork.length ? `, and ${offGoalWork.length} completed item${offGoalWork.length === 1 ? '' : 's'} sat outside linked goal projects` : ''}.`,
    sections: [
      { title: 'Progress', items: completed.slice(0, 10).map((task) => ({ text: task.content, citationIds: [`task:${task.id}`] })) },
      {
        title: 'Repeated delays',
        items: delayed.slice(0, 10).map((task) => ({ text: `${task.content} · due ${task.dueDate}`, citationIds: [`task:${task.id}`] })),
      },
      { title: 'Goal alignment', items: activeGoals.map((goal) => ({ text: goal.title, citationIds: [`goal:${goal.id}`] })) },
    ].filter((section) => section.items.length),
    citations: evidence(db, citationIds),
    proposedActions: [],
  };
}

function upsertInsight(
  db: DB,
  input: Omit<ProactiveInsight, 'id' | 'status' | 'surfacedAt' | 'createdAt' | 'evidence'> & { evidenceIds: string[] },
) {
  const now = nowUtcIso();
  const existing = db.select().from(proactiveInsights).where(eq(proactiveInsights.cooldownKey, input.cooldownKey)).get();
  if (existing) return;
  db.insert(proactiveInsights)
    .values({
      id: randomUUID(),
      kind: input.kind,
      title: input.title,
      body: input.body,
      priority: input.priority,
      status: 'new',
      evidenceIds: JSON.stringify(input.evidenceIds),
      cooldownKey: input.cooldownKey,
      expiresAtUtc: input.expiresAt,
      createdAtUtc: now,
    })
    .run();
}

export function refreshProactiveInsights(db: DB): number {
  const settings = getSettings(db);
  if (!settings.assistantProactiveEnabled) return 0;
  const before = db.select({ id: proactiveInsights.id }).from(proactiveInsights).all().length;
  const now = nowUtcIso();
  const today = now.slice(0, 10);
  const overdue = db
    .select()
    .from(commitments)
    .where(inArray(commitments.status, ['open', 'waiting']))
    .all()
    .filter((item) => !!item.dueAtUtc && item.dueAtUtc < now);
  for (const item of overdue) {
    upsertInsight(db, {
      kind: 'forgotten_commitment',
      title: 'Commitment needs attention',
      body: `${item.title} was due ${DateTime.fromISO(item.dueAtUtc!).setZone(settings.timezone).toFormat('LLL d, HH:mm')}.`,
      priority: 'high',
      evidenceIds: JSON.parse(item.evidenceIds || '[]') as string[],
      cooldownKey: `commitment-overdue:${item.id}:${today}`,
      expiresAt: null,
    });
  }

  const upcoming = db
    .select()
    .from(events)
    .all()
    .filter((event) => event.endUtc >= now && event.startUtc <= new Date(Date.now() + 7 * 86_400_000).toISOString())
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  for (let i = 1; i < upcoming.length; i++) {
    const previous = upcoming[i - 1]!;
    const current = upcoming[i]!;
    if (current.startUtc < previous.endUtc) {
      upsertInsight(db, {
        kind: 'calendar_conflict',
        title: 'Calendar conflict',
        body: `${previous.title} overlaps ${current.title}.`,
        priority: 'high',
        evidenceIds: [`calendar:${previous.id}`, `calendar:${current.id}`],
        cooldownKey: `calendar-conflict:${previous.id}:${current.id}`,
        expiresAt: current.endUtc,
      });
    }
  }

  const nextMeeting = upcoming.find((event) => event.startUtc >= now && event.startUtc <= new Date(Date.now() + 24 * 60 * 60_000).toISOString());
  if (nextMeeting) {
    upsertInsight(db, {
      kind: 'meeting_prep',
      title: `Prepare for ${nextMeeting.title}`,
      body: `Starts ${DateTime.fromISO(nextMeeting.startUtc).setZone(settings.timezone).toFormat('ccc, HH:mm')}. Ask the assistant for related notes, decisions, and open commitments.`,
      priority: 'medium',
      evidenceIds: [`calendar:${nextMeeting.id}`],
      cooldownKey: `meeting-prep:${nextMeeting.id}`,
      expiresAt: nextMeeting.endUtc,
    });
  }

  const recentCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const recentCompleted = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.isDeleted, 0), eq(tasks.status, 'done')))
    .all()
    .filter((task) => !!task.completedAtUtc && task.completedAtUtc >= recentCutoff);
  const linkedGoals = db
    .select()
    .from(goals)
    .where(eq(goals.status, 'active'))
    .all()
    .filter((goal) => goal.linkKind === 'project' && !!goal.linkValue);
  for (const goal of linkedGoals) {
    if (recentCompleted.some((task) => task.projectId === goal.linkValue)) continue;
    upsertInsight(db, {
      kind: 'goal_drift',
      title: 'A goal has no recent supporting work',
      body: `${goal.title} has no completed task in its linked project during the last 14 days.`,
      priority: 'medium',
      evidenceIds: [`goal:${goal.id}`],
      cooldownKey: `goal-drift:${goal.id}:${today}`,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
  }

  const goalWords = linkedGoals
    .flatMap((goal) => goal.title.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((word) => !['goal', 'project', 'هدف', 'مشروع'].includes(word));
  if (goalWords.length) {
    const oldCutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const forgotten = db
      .select()
      .from(knowledgeRecords)
      .all()
      .find(
        (record) =>
          record.sourceType === 'note' &&
          !record.deletedAtUtc &&
          !!record.occurredAtUtc &&
          record.occurredAtUtc < oldCutoff &&
          goalWords.some((word) => `${record.title}\n${record.excerpt}`.toLocaleLowerCase().includes(word)),
      );
    if (forgotten) {
      upsertInsight(db, {
        kind: 'forgotten_knowledge',
        title: 'An older note connects to an active goal',
        body: `${forgotten.title} may be useful again.`,
        priority: 'low',
        evidenceIds: [forgotten.id],
        cooldownKey: `forgotten-note:${forgotten.id}:${today}`,
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
    }
  }

  const hourStats = db
    .select()
    .from(learnedStats)
    .all()
    .filter((stat) => stat.scope === 'global' && stat.key.startsWith('hour_success:') && stat.weight >= 3)
    .sort((a, b) => b.value - a.value);
  if (hourStats[0]) {
    const hour = Number(hourStats[0].key.split(':')[1]);
    const recordId = upsertKnowledgeRecord(db, {
      sourceType: 'manual',
      sourceId: 'learning:best-hour',
      title: 'Learned focus pattern',
      excerpt: `Observed completion data indicates the strongest hour begins around ${String(hour).padStart(2, '0')}:00 (score ${hourStats[0].value.toFixed(2)}, weight ${hourStats[0].weight.toFixed(1)}).`,
      occurredAt: hourStats[0].updatedAtUtc,
    });
    upsertInsight(db, {
      kind: 'work_pattern',
      title: 'Protect your strongest completion hour',
      body: `Your observed completion rate is strongest around ${String(hour).padStart(2, '0')}:00.`,
      priority: 'low',
      evidenceIds: [recordId],
      cooldownKey: `best-hour:${hour}:${today}`,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
  }

  const local = DateTime.now().setZone(settings.timezone);
  if (!inQuietHours(local, settings.assistantQuietHoursStart, settings.assistantQuietHoursEnd)) {
    const surfacedToday = db
      .select()
      .from(proactiveInsights)
      .all()
      .filter((item) => item.surfacedAtUtc?.slice(0, 10) === today).length;
    const budget = Math.max(0, settings.assistantDailyNotificationBudget - surfacedToday);
    const toSurface = db
      .select()
      .from(proactiveInsights)
      .where(and(eq(proactiveInsights.status, 'new'), isNull(proactiveInsights.surfacedAtUtc)))
      .all()
      .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1))
      .slice(0, budget);
    for (const item of toSurface) db.update(proactiveInsights).set({ surfacedAtUtc: now }).where(eq(proactiveInsights.id, item.id)).run();
  }
  return db.select({ id: proactiveInsights.id }).from(proactiveInsights).all().length - before;
}

export function listProactiveInsights(db: DB): ProactiveInsight[] {
  refreshProactiveInsights(db);
  return db
    .select()
    .from(proactiveInsights)
    .where(ne(proactiveInsights.status, 'dismissed'))
    .all()
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))
    .map((row) => ({
      id: row.id,
      kind: row.kind as ProactiveInsight['kind'],
      title: row.title,
      body: row.body,
      priority: row.priority as ProactiveInsight['priority'],
      status: row.status as ProactiveInsight['status'],
      evidence: evidence(db, JSON.parse(row.evidenceIds || '[]') as string[]),
      cooldownKey: row.cooldownKey,
      surfacedAt: row.surfacedAtUtc,
      expiresAt: row.expiresAtUtc,
      createdAt: row.createdAtUtc,
    }));
}
