#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.TIMEBLOCK_API_URL ?? 'http://127.0.0.1:4141/api';

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = (data && typeof data === 'object' && 'error' in data) ? String((data as { error: unknown }).error) : text;
    throw new Error(`TimeBlock API ${method} ${path} -> ${res.status}: ${message}`);
  }
  return data;
}

function result(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

async function tool(fn: () => Promise<unknown>) {
  try {
    return result(await fn());
  } catch (err) {
    return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

const server = new McpServer({ name: 'timeblock', version: '0.1.0' });

const taskFields = {
  content: z.string().min(1).optional().describe('Task title'),
  description: z.string().optional(),
  projectId: z.string().nullable().optional().describe('Project id, or null for Inbox'),
  parentId: z.string().nullable().optional().describe('Parent task id, for subtasks'),
  priority: z.number().int().min(1).max(4).optional().describe('1 = highest priority, 4 = lowest/default'),
  dueDate: z.string().nullable().optional().describe('Due date, YYYY-MM-DD'),
  dueDatetimeUtc: z.string().nullable().optional().describe('Due date+time, UTC ISO string'),
  durationMin: z.number().int().positive().nullable().optional().describe('Estimated duration in minutes, used by the scheduler'),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional().describe('Feeds energy-window matching in the scheduler'),
  labels: z.array(z.string()).optional(),
  links: z.array(z.object({ url: z.string().url(), title: z.string().optional() })).optional(),
  color: z.string().nullable().optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']).optional(),
  skipScheduling: z.boolean().optional().describe('If true, the auto-scheduler will not place this task on the calendar'),
};

server.registerTool(
  'list_tasks',
  {
    title: 'List tasks',
    description: 'List open tasks grouped by their scheduling view (all, scheduled, unscheduled, missed, at_risk, unplaceable).',
    inputSchema: { view: z.enum(['all', 'scheduled', 'unscheduled', 'missed', 'at_risk', 'unplaceable']).optional() },
  },
  async ({ view }) => tool(() => api('GET', `/tasks?view=${view ?? 'all'}`)),
);

server.registerTool(
  'search_tasks',
  {
    title: 'Search tasks',
    description: 'Search/filter all tasks (including backlog and, optionally, closed) by text, project, label, status, priority, due date range, or parent.',
    inputSchema: {
      q: z.string().optional().describe('Free-text search over title/description'),
      projectId: z.string().optional().describe('Project id, or "inbox" for tasks with no project'),
      label: z.string().optional(),
      status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']).optional(),
      priority: z.number().int().min(1).max(4).optional(),
      dueFrom: z.string().optional().describe('YYYY-MM-DD'),
      dueTo: z.string().optional().describe('YYYY-MM-DD'),
      parentId: z.string().optional().describe('Pass "" to find only top-level tasks'),
      includeClosed: z.boolean().optional().describe('Include cancelled tasks too (done is always included)'),
    },
  },
  async (q) =>
    tool(() => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
      return api('GET', `/tasks/all?${params.toString()}`);
    }),
);

server.registerTool(
  'list_upcoming_tasks',
  {
    title: 'List upcoming tasks',
    description: 'Overdue tasks plus tasks due in the next N days, grouped by date.',
    inputSchema: { days: z.number().int().min(1).max(60).optional() },
  },
  async ({ days }) => tool(() => api('GET', `/tasks/upcoming?days=${days ?? 7}`)),
);

server.registerTool(
  'get_task',
  {
    title: 'Get task detail',
    description: 'Get full detail for one task: fields, subtasks, attachments, reminders.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => tool(() => api('GET', `/tasks/${id}`)),
);

server.registerTool(
  'create_task',
  {
    title: 'Create task',
    description: 'Create a new task. It will be auto-scheduled onto the calendar unless skipScheduling is set.',
    inputSchema: { ...taskFields, content: z.string().min(1) },
  },
  async (input) => tool(() => api('POST', '/tasks', input)),
);

server.registerTool(
  'update_task',
  {
    title: 'Update task',
    description: 'Edit fields on an existing task. Only pass the fields you want to change.',
    inputSchema: { id: z.string(), ...taskFields },
  },
  async ({ id, ...patch }) => tool(() => api('PATCH', `/tasks/${id}`, patch)),
);

server.registerTool(
  'complete_task',
  { title: 'Complete task', description: 'Mark a task done and remove its calendar block.', inputSchema: { id: z.string() } },
  async ({ id }) => tool(() => api('POST', `/tasks/${id}/complete`)),
);

server.registerTool(
  'reopen_task',
  { title: 'Reopen task', description: 'Set a done/cancelled task back to todo.', inputSchema: { id: z.string() } },
  async ({ id }) => tool(() => api('POST', `/tasks/${id}/reopen`)),
);

server.registerTool(
  'delete_task',
  { title: 'Delete task', description: 'Permanently delete a task and its calendar block.', inputSchema: { id: z.string() } },
  async ({ id }) => tool(() => api('DELETE', `/tasks/${id}`)),
);

server.registerTool(
  'schedule_task_at',
  {
    title: 'Schedule task at a specific time',
    description: 'Pin a task to an explicit start/end time on the calendar (like dragging it onto a slot). Locks it so the auto-scheduler leaves it there.',
    inputSchema: { id: z.string(), startUtc: z.string().describe('UTC ISO datetime'), endUtc: z.string().describe('UTC ISO datetime, must be after startUtc') },
  },
  async ({ id, startUtc, endUtc }) => tool(() => api('POST', `/tasks/${id}/schedule-at`, { startUtc, endUtc })),
);

server.registerTool(
  'unschedule_task',
  {
    title: 'Unschedule task',
    description: 'Remove a task from the calendar and stop the auto-scheduler from placing it.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => tool(() => api('POST', `/tasks/${id}/unschedule`)),
);

server.registerTool(
  'reschedule_task',
  {
    title: 'Reschedule task',
    description: 'Let the auto-scheduler place (or re-place) this task on the calendar again.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => tool(() => api('POST', `/tasks/${id}/reschedule`)),
);

server.registerTool(
  'get_schedule',
  {
    title: 'Get calendar schedule',
    description: 'List calendar items (task blocks + busy external events) in a UTC time window.',
    inputSchema: {
      from: z.string().describe('UTC ISO datetime, inclusive start'),
      to: z.string().describe('UTC ISO datetime, exclusive end'),
      includeExternal: z.boolean().optional().describe('Include busy events from other connected Google calendars (default true)'),
    },
  },
  async ({ from, to, includeExternal }) => tool(() => api('GET', `/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&external=${includeExternal === false ? '0' : '1'}`)),
);

server.registerTool(
  'list_projects',
  { title: 'List projects', description: 'List all projects with task counts.', inputSchema: {} },
  async () => tool(() => api('GET', '/projects')),
);

server.registerTool(
  'create_project',
  {
    title: 'Create project',
    description: 'Create a new project.',
    inputSchema: {
      name: z.string().min(1),
      description: z.string().optional(),
      color: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      sortOrder: z.number().int().optional(),
    },
  },
  async (input) => tool(() => api('POST', '/projects', input)),
);

server.registerTool(
  'update_project',
  {
    title: 'Update project',
    description: 'Edit an existing project.',
    inputSchema: {
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      color: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      sortOrder: z.number().int().optional(),
      archived: z.boolean().optional(),
    },
  },
  async ({ id, ...patch }) => tool(() => api('PATCH', `/projects/${id}`, patch)),
);

server.registerTool(
  'delete_project',
  {
    title: 'Delete project',
    description: 'Delete a project. Its tasks move to the Inbox rather than being deleted.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => tool(() => api('DELETE', `/projects/${id}`)),
);

server.registerTool(
  'list_labels',
  { title: 'List labels', description: 'List all labels with task counts.', inputSchema: {} },
  async () => tool(() => api('GET', '/labels')),
);

server.registerTool(
  'create_label',
  {
    title: 'Create label',
    description: 'Create a new label (or return the existing one if the name is already taken).',
    inputSchema: { name: z.string().min(1), color: z.string().nullable().optional() },
  },
  async (input) => tool(() => api('POST', '/labels', input)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
