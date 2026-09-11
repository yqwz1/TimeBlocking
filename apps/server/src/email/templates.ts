import { DateTime } from 'luxon';
import type { ScheduleItemDTO } from '@timeblock/shared';
import type { AgendaEmailModel, RecapEmailModel } from './content.js';

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function localTime(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).toFormat('HH:mm');
}

function longDate(date: string, timezone: string): string {
  return DateTime.fromISO(date, { zone: timezone }).toFormat('cccc, d LLLL yyyy');
}

function itemLabel(item: ScheduleItemDTO): string {
  if (item.kind === 'habit') return 'Habit';
  if (item.kind === 'event') return 'Event';
  return item.chunk ? `Task · part ${item.chunk.index + 1} of ${item.chunk.count}` : 'Task';
}

function textItems(items: ScheduleItemDTO[], timezone: string): string[] {
  if (!items.length) return ['No scheduled items.'];
  return items.map((item) => `${localTime(item.start, timezone)}–${localTime(item.end, timezone)}  ${item.title} (${itemLabel(item)})`);
}

function htmlItems(items: ScheduleItemDTO[], timezone: string): string {
  if (!items.length) return '<p>No scheduled items.</p>';
  return `<ul>${items.map((item) => `<li><strong>${localTime(item.start, timezone)}–${localTime(item.end, timezone)}</strong> ${escapeHtml(item.title)} <small>(${escapeHtml(itemLabel(item))})</small></li>`).join('')}</ul>`;
}

export function renderMorningAgenda(model: AgendaEmailModel): EmailMessage {
  const title = longDate(model.date, model.timezone);
  const unscheduledText = model.unscheduledTasks.length
    ? model.unscheduledTasks.map((task) => `- ${task.title}`).join('\n')
    : 'None.';
  const unscheduledHtml = model.unscheduledTasks.length
    ? `<ul>${model.unscheduledTasks.map((task) => `<li>${escapeHtml(task.title)}</li>`).join('')}</ul>`
    : '<p>None.</p>';
  return {
    subject: `TimeBlocking agenda — ${title}`,
    text: [`Your agenda for ${title}`, '', ...textItems(model.schedule, model.timezone), '', 'Open tasks planned or due today without a block', unscheduledText].join('\n'),
    html: `<h1>Your agenda for ${escapeHtml(title)}</h1>${htmlItems(model.schedule, model.timezone)}<h2>Open tasks planned or due today without a block</h2>${unscheduledHtml}`,
  };
}

export function renderTaskReminder(item: ScheduleItemDTO, timezone: string, leadMinutes: number): EmailMessage {
  const time = `${localTime(item.start, timezone)}–${localTime(item.end, timezone)}`;
  const chunk = item.chunk ? ` (part ${item.chunk.index + 1} of ${item.chunk.count})` : '';
  return {
    subject: `Starts in ${leadMinutes} minutes: ${item.title}`,
    text: [`${item.title}${chunk}`, `Today, ${time} (${timezone})`, item.projectName ? `Project: ${item.projectName}` : ''].filter(Boolean).join('\n'),
    html: `<h1>${escapeHtml(item.title)}${escapeHtml(chunk)}</h1><p><strong>Today, ${escapeHtml(time)}</strong> (${escapeHtml(timezone)})</p>${item.projectName ? `<p>Project: ${escapeHtml(item.projectName)}</p>` : ''}`,
  };
}

function statusSection(title: string, items: ScheduleItemDTO[], timezone: string): { text: string; html: string } {
  return {
    text: `${title}\n${textItems(items, timezone).join('\n')}`,
    html: `<h2>${escapeHtml(title)}</h2>${htmlItems(items, timezone)}`,
  };
}

export function renderDailyRecap(model: RecapEmailModel): EmailMessage {
  const title = longDate(model.date, model.timezone);
  const completed = statusSection('Completed blocks', model.blocks.filter((item) => item.status === 'done'), model.timezone);
  const missed = statusSection('Missed blocks', model.blocks.filter((item) => item.status === 'missed'), model.timezone);
  const remaining = statusSection('Remaining blocks', model.blocks.filter((item) => item.status === 'scheduled' || item.status === 'pending_create'), model.timezone);
  const completedTasksText = model.completedTasks.length ? model.completedTasks.map((task) => `- ${task.title}`).join('\n') : 'None.';
  const openTasksText = model.openTasks.length ? model.openTasks.map((task) => `- ${task.title}`).join('\n') : 'None.';
  const ritualText = [
    `Highlight: ${model.ritual.highlight || 'Not set'}${model.ritual.highlight ? (model.ritual.highlightDone ? ' (done)' : ' (not completed)') : ''}`,
    `Rating: ${model.ritual.rating == null ? 'Not rated' : `${model.ritual.rating}/5`}`,
    `Reflection: ${model.ritual.reflection || 'Not added'}`,
  ].join('\n');
  const taskList = (items: Array<{ title: string }>) => items.length ? `<ul>${items.map((task) => `<li>${escapeHtml(task.title)}</li>`).join('')}</ul>` : '<p>None.</p>';
  return {
    subject: `TimeBlocking recap — ${title}`,
    text: [
      `Daily recap for ${title}`,
      `${model.summary.completedMin} of ${model.summary.plannedMin} planned minutes completed (${model.completionPercentage}%)`,
      '', completed.text, '', missed.text, '', remaining.text,
      '', 'Tasks completed today', completedTasksText,
      '', 'Tasks still open from today', openTasksText,
      '', 'Shutdown ritual', ritualText,
    ].join('\n'),
    html: `<h1>Daily recap for ${escapeHtml(title)}</h1><p><strong>${model.summary.completedMin} of ${model.summary.plannedMin} planned minutes completed (${model.completionPercentage}%)</strong></p>${completed.html}${missed.html}${remaining.html}<h2>Tasks completed today</h2>${taskList(model.completedTasks)}<h2>Tasks still open from today</h2>${taskList(model.openTasks)}<h2>Shutdown ritual</h2><p><strong>Highlight:</strong> ${escapeHtml(model.ritual.highlight || 'Not set')}${model.ritual.highlight ? (model.ritual.highlightDone ? ' (done)' : ' (not completed)') : ''}<br><strong>Rating:</strong> ${model.ritual.rating == null ? 'Not rated' : `${model.ritual.rating}/5`}<br><strong>Reflection:</strong> ${escapeHtml(model.ritual.reflection || 'Not added')}</p>`,
  };
}

export function renderTestEmail(timezone: string): EmailMessage {
  const sent = DateTime.now().setZone(timezone).toFormat('d LLL yyyy, HH:mm');
  return {
    subject: 'TimeBlocking email notifications are ready',
    text: `This test email was sent from TimeBlocking at ${sent} (${timezone}).`,
    html: `<h1>Email notifications are ready</h1><p>This test email was sent from TimeBlocking at ${escapeHtml(sent)} (${escapeHtml(timezone)}).</p>`,
  };
}
