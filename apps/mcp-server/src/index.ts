#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
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
  plannedForDate: z.string().nullable().optional().describe('Local YYYY-MM-DD — "picked for today/tomorrow" in the Plan Day ritual'),
};

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const HHMM = z.string().regex(/^\d{2}:\d{2}$/);

const habitFields = {
  name: z.string().min(1),
  durationMin: z.number().int().min(5).max(480),
  days: z.array(z.enum(WEEKDAYS)).min(1).describe('Weekdays the habit recurs on; all 7 = daily'),
  preferredStart: HHMM.nullable(),
  windowStart: HHMM,
  windowEnd: HHMM,
  priority: z.number().int().min(1).max(4),
  kind: z.enum(['habit', 'learning']),
  weeklyTargetMin: z.number().int().positive().nullable().describe('Learning goals: extra sessions are added until this many minutes/week are planned'),
  notes: z.string(),
  active: z.boolean(),
};

const goalFields = {
  title: z.string().min(1),
  description: z.string(),
  targetValue: z.number().int().positive().nullable(),
  targetUnit: z.string().nullable(),
  achievable: z.string().describe('Achievable rationale'),
  relevance: z.string().describe('Why this goal matters'),
  year: z.number().int().min(2020).max(2100),
  quarter: z.number().int().min(1).max(4),
  customDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  linkKind: z.enum(['project', 'label']).nullable(),
  linkValue: z.string().nullable(),
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

server.registerTool(
  'list_habits',
  { title: 'List habits', description: 'List all habits/learning routines with this week\'s progress, streaks, and today\'s status.', inputSchema: {} },
  async () => tool(() => api('GET', '/habits')),
);

server.registerTool(
  'create_habit',
  { title: 'Create habit', description: 'Create a new recurring habit or learning routine.', inputSchema: habitFields },
  async (input) => tool(() => api('POST', '/habits', input)),
);

server.registerTool(
  'update_habit',
  {
    title: 'Update habit',
    description: 'Edit fields on an existing habit. Only pass the fields you want to change.',
    inputSchema: { id: z.string(), ...Object.fromEntries(Object.entries(habitFields).map(([k, v]) => [k, v.optional()])) },
  },
  async ({ id, ...patch }) => tool(() => api('PATCH', `/habits/${id}`, patch)),
);

server.registerTool(
  'delete_habit',
  { title: 'Delete habit', description: 'Permanently delete a habit and its scheduled instances.', inputSchema: { id: z.string() } },
  async ({ id }) => tool(() => api('DELETE', `/habits/${id}`)),
);

server.registerTool(
  'complete_habit_today',
  { title: 'Complete habit for today', description: "Mark today's occurrence of a habit as done.", inputSchema: { id: z.string() } },
  async ({ id }) => tool(() => api('POST', `/habits/${id}/complete-today`)),
);

server.registerTool(
  'skip_habit_today',
  { title: 'Skip habit for today', description: "Mark today's occurrence of a habit as skipped.", inputSchema: { id: z.string() } },
  async ({ id }) => tool(() => api('POST', `/habits/${id}/skip-today`)),
);

server.registerTool(
  'list_goals',
  {
    title: 'List quarterly SMART goals',
    description: 'List goals for a year/quarter, with computed progress. Defaults to the current quarter.',
    inputSchema: {
      year: z.number().int().min(2020).max(2100).optional(),
      quarter: z.union([z.number().int().min(1).max(4), z.literal('all')]).optional(),
    },
  },
  async ({ year, quarter }) =>
    tool(() => {
      const params = new URLSearchParams();
      if (year !== undefined) params.set('year', String(year));
      if (quarter !== undefined) params.set('quarter', String(quarter));
      return api('GET', `/goals?${params.toString()}`);
    }),
);

server.registerTool(
  'create_goal',
  { title: 'Create SMART goal', description: 'Create a new quarterly SMART goal.', inputSchema: goalFields },
  async (input) => tool(() => api('POST', '/goals', input)),
);

server.registerTool(
  'update_goal',
  {
    title: 'Update goal',
    description: 'Edit fields on an existing goal, including its status or current progress value. Only pass the fields you want to change.',
    inputSchema: {
      id: z.string(),
      ...Object.fromEntries(Object.entries(goalFields).map(([k, v]) => [k, v.optional()])),
      currentValue: z.number().optional(),
      status: z.enum(['active', 'achieved', 'dropped']).optional(),
    },
  },
  async ({ id, ...patch }) => tool(() => api('PATCH', `/goals/${id}`, patch)),
);

server.registerTool(
  'delete_goal',
  { title: 'Delete goal', description: 'Delete a goal and its milestones.', inputSchema: { id: z.string() } },
  async ({ id }) => tool(() => api('DELETE', `/goals/${id}`)),
);

server.registerTool(
  'add_goal_milestone',
  { title: 'Add goal milestone', description: 'Add a milestone to a goal.', inputSchema: { goalId: z.string(), title: z.string().min(1) } },
  async ({ goalId, title }) => tool(() => api('POST', `/goals/${goalId}/milestones`, { title })),
);

server.registerTool(
  'update_goal_milestone',
  {
    title: 'Update goal milestone',
    description: 'Rename a milestone or mark it done/undone.',
    inputSchema: { goalId: z.string(), milestoneId: z.string(), title: z.string().min(1).optional(), done: z.boolean().optional() },
  },
  async ({ goalId, milestoneId, ...patch }) => tool(() => api('PATCH', `/goals/${goalId}/milestones/${milestoneId}`, patch)),
);

server.registerTool(
  'delete_goal_milestone',
  { title: 'Delete goal milestone', description: 'Remove a milestone from a goal.', inputSchema: { goalId: z.string(), milestoneId: z.string() } },
  async ({ goalId, milestoneId }) => tool(() => api('DELETE', `/goals/${goalId}/milestones/${milestoneId}`)),
);

function isAuthorized(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== 'string') return false;

  const expected = `Bearer ${token}`;
  const actualBytes = Buffer.from(header);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function startHttpServer(): Promise<void> {
  const token = process.env.TIMEBLOCK_MCP_TOKEN;
  if (!token) {
    throw new Error('TIMEBLOCK_MCP_TOKEN is required when running the HTTP MCP server.');
  }

  const port = Number(process.env.TIMEBLOCK_MCP_PORT ?? 3333);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('TIMEBLOCK_MCP_PORT must be an integer between 1 and 65535.');
  }

  const host = process.env.TIMEBLOCK_MCP_HOST ?? '127.0.0.1';
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const httpServer = createServer((request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (!isAuthorized(request.headers.authorization, token)) {
      response.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer',
      });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    void transport.handleRequest(request, response).catch((error: unknown) => {
      console.error('[timeblock-mcp] HTTP request failed', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });

  httpServer.on('error', (error) => {
    console.error('[timeblock-mcp] HTTP server failed', error);
    process.exitCode = 1;
  });
  httpServer.listen(port, host, () => {
    console.error(`[timeblock-mcp] Listening on http://${host}:${port}/mcp`);
  });
}

if (process.argv.includes('--http')) {
  await startHttpServer();
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
