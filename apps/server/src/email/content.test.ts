import { describe, expect, it } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { blocks, dailyPlans, events, habits, tasks } from '../db/schema.js';
import { getSettings } from '../settings.js';
import { buildAgendaEmailModel, buildRecapEmailModel } from './content.js';
import { renderDailyRecap, renderMorningAgenda } from './templates.js';

describe('email content selection', () => {
  it('orders local schedule items and lists each unscheduled task once', () => {
    const db: DB = createDb(':memory:');
    const settings = { ...getSettings(db), timezone: 'Asia/Riyadh' };
    db.insert(tasks).values([
      { id: 'scheduled', content: 'Scheduled work', status: 'todo', dueDate: '2026-09-08' },
      { id: 'unscheduled', content: 'Unscheduled & urgent', status: 'todo', dueDate: '2026-09-08', plannedForDate: '2026-09-08' },
    ]).run();
    db.insert(blocks).values({ id: 'block', taskId: 'scheduled', startUtc: '2026-09-08T07:00:00.000Z', endUtc: '2026-09-08T08:00:00.000Z', status: 'scheduled' }).run();
    db.insert(events).values({ id: 'event', title: 'Stand-up', startUtc: '2026-09-08T06:00:00.000Z', endUtc: '2026-09-08T06:30:00.000Z' }).run();
    db.insert(habits).values({ id: 'habit', name: 'Read', durationMin: 30, rrule: 'FREQ=DAILY', preferredStart: '08:00', windowStart: '06:00', windowEnd: '22:00', kind: 'habit' }).run();

    const model = buildAgendaEmailModel(db, settings, '2026-09-08');
    expect(model.schedule.map((item) => item.title)).toEqual(['Read', 'Stand-up', 'Scheduled work']);
    expect(model.unscheduledTasks).toEqual([expect.objectContaining({ id: 'unscheduled' })]);
    const rendered = renderMorningAgenda(model);
    expect(rendered.html).toContain('Unscheduled &amp; urgent');
    expect(rendered.text).toContain('Open tasks planned or due today without a block');
  });

  it('builds an empty day without failing', () => {
    const db: DB = createDb(':memory:');
    const settings = { ...getSettings(db), timezone: 'Asia/Riyadh' };
    const agenda = renderMorningAgenda(buildAgendaEmailModel(db, settings, '2026-09-08'));
    const recap = renderDailyRecap(buildRecapEmailModel(db, settings, '2026-09-08'));
    expect(agenda.text).toContain('No scheduled items.');
    expect(recap.text).toContain('0 of 0 planned minutes completed (0%)');
  });

  it('uses local completion dates and includes shutdown details in the recap', () => {
    const db: DB = createDb(':memory:');
    const settings = { ...getSettings(db), timezone: 'Asia/Riyadh' };
    db.insert(tasks).values([
      { id: 'done', content: 'Finished late', status: 'done', isCompleted: 1, completedAtUtc: '2026-09-07T22:30:00.000Z' },
      { id: 'open', content: 'Still open', status: 'todo', plannedForDate: '2026-09-08' },
    ]).run();
    db.insert(blocks).values([
      { id: 'done-block', taskId: 'done', startUtc: '2026-09-08T06:00:00.000Z', endUtc: '2026-09-08T07:00:00.000Z', status: 'done' },
      { id: 'missed-block', taskId: 'open', startUtc: '2026-09-08T08:00:00.000Z', endUtc: '2026-09-08T08:30:00.000Z', status: 'missed' },
    ]).run();
    db.insert(dailyPlans).values({ date: '2026-09-08', highlight: 'Ship <feature>', highlightDone: 1, rating: 4, reflection: 'Good & focused', shutdownDoneAtUtc: '2026-09-08T19:00:00.000Z' }).run();

    const model = buildRecapEmailModel(db, settings, '2026-09-08');
    expect(model.completedTasks.map((task) => task.id)).toEqual(['done']);
    expect(model.openTasks.map((task) => task.id)).toEqual(['open']);
    expect(model.summary).toMatchObject({ completedMin: 60, plannedMin: 90, doneCount: 1, missedCount: 1 });
    expect(model.completionPercentage).toBe(67);
    const rendered = renderDailyRecap(model);
    expect(rendered.html).toContain('Ship &lt;feature&gt;');
    expect(rendered.html).toContain('Good &amp; focused');
  });
});
