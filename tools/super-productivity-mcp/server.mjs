#!/usr/bin/env node
/**
 * Narrow stdio MCP adapter for Super Productivity's local REST API.
 * The token is accepted only through SUPER_PRODUCTIVITY_API_TOKEN at runtime.
 */
import readline from 'node:readline';

const baseUrl = process.env.SUPER_PRODUCTIVITY_API_URL || 'http://127.0.0.1:3876';
const token = process.env.SUPER_PRODUCTIVITY_API_TOKEN;
const priorityTags = new Set(['EM_URGENT', 'EM_IMPORTANT']);

const fail = (message, details) => ({
  isError: true,
  content: [{ type: 'text', text: message }],
  ...(details ? { structuredContent: details } : {}),
});
const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
const schema = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = { type: 'string' };
const bool = { type: 'boolean' };

const tools = [
  {
    name: 'list_projects',
    description: 'List authoritative projects. Optionally filter by title.',
    inputSchema: schema({ query: string }),
  },
  {
    name: 'list_tasks',
    description: 'List active tasks, optionally scoped to a project.',
    inputSchema: schema({ project_id: string, include_done: bool }),
  },
  {
    name: 'get_task',
    description: 'Read one task by its stable Super Productivity ID.',
    inputSchema: schema({ task_id: string }, ['task_id']),
  },
  {
    name: 'search_tasks',
    description: 'Search task titles before creating or changing a task.',
    inputSchema: schema({ query: string, project_id: string }, ['query']),
  },
  {
    name: 'tasks_due_today',
    description: 'List tasks due in Super Productivity’s logical today.',
    inputSchema: schema({ include_done: bool }),
  },
  {
    name: 'overdue_tasks',
    description: 'List overdue tasks using Super Productivity’s logical-day calculation.',
    inputSchema: schema({ project_id: string, include_done: bool }),
  },
  {
    name: 'tasks_by_project',
    description: 'List tasks for one project ID.',
    inputSchema: schema({ project_id: string, include_done: bool }, ['project_id']),
  },
  {
    name: 'create_task',
    description:
      'Controlled create: searches exact-title duplicates and verifies the project before creating and reading back.',
    inputSchema: schema(
      {
        title: string,
        project_id: string,
        notes: string,
        due_day: { type: ['string', 'null'] },
        priority: { enum: ['none', 'urgent', 'important', 'urgent_important'] },
      },
      ['title', 'project_id', 'priority'],
    ),
  },
  {
    name: 'update_task',
    description:
      'Controlled narrow update: reads the exact task, applies only supplied fields, then reads it back.',
    inputSchema: schema(
      {
        task_id: string,
        title: string,
        notes: string,
        due_day: { type: ['string', 'null'] },
        project_id: string,
        priority: { enum: ['none', 'urgent', 'important', 'urgent_important'] },
      },
      ['task_id'],
    ),
  },
  {
    name: 'complete_task',
    description:
      'Controlled completion: reads the exact task, completes it, and verifies the final task state.',
    inputSchema: schema({ task_id: string }, ['task_id']),
  },
];

const api = async (path, options = {}) => {
  if (!token) throw new Error('SUPER_PRODUCTIVITY_API_TOKEN is required');
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await response.json();
  if (!response.ok || !body.ok)
    throw new Error(
      body.error?.message || `Super Productivity API returned ${response.status}`,
    );
  return body.data;
};
const query = (params) => {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) result.set(key, String(value));
  const text = result.toString();
  return text ? `?${text}` : '';
};
const priorityTagIds = (existing, priority) => {
  const rest = existing.filter((id) => !priorityTags.has(id));
  if (priority === 'urgent' || priority === 'urgent_important') rest.push('EM_URGENT');
  if (priority === 'important' || priority === 'urgent_important')
    rest.push('EM_IMPORTANT');
  return rest;
};
const requireObject = (args) =>
  args && typeof args === 'object' && !Array.isArray(args) ? args : {};

const callTool = async (name, rawArgs) => {
  const args = requireObject(rawArgs);
  try {
    switch (name) {
      case 'list_projects':
        return ok(await api(`/projects${query({ query: args.query })}`));
      case 'list_tasks':
        return ok(
          await api(
            `/tasks${query({ projectId: args.project_id, includeDone: args.include_done })}`,
          ),
        );
      case 'get_task':
        return ok(await api(`/tasks/${encodeURIComponent(args.task_id)}`));
      case 'search_tasks':
        return ok(
          await api(`/tasks${query({ query: args.query, projectId: args.project_id })}`),
        );
      case 'tasks_due_today':
        return ok(
          await api(`/tasks${query({ tagId: 'TODAY', includeDone: args.include_done })}`),
        );
      case 'overdue_tasks':
        return ok(
          await api(
            `/tasks${query({ overdue: true, projectId: args.project_id, includeDone: args.include_done })}`,
          ),
        );
      case 'tasks_by_project':
        return ok(
          await api(
            `/tasks${query({ projectId: args.project_id, includeDone: args.include_done })}`,
          ),
        );
      case 'create_task': {
        const matches = await api(
          `/tasks${query({ query: args.title, projectId: args.project_id, includeDone: true })}`,
        );
        const duplicates = matches.filter(
          (task) =>
            task.title.trim().toLocaleLowerCase() ===
            args.title.trim().toLocaleLowerCase(),
        );
        if (duplicates.length)
          return fail('Possible duplicate task; inspect it before creating another.', {
            duplicates,
          });
        const projects = await api('/projects');
        if (!projects.some((project) => project.id === args.project_id))
          return fail('Target project was not found.');
        const created = await api('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: args.title,
            projectId: args.project_id,
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
            ...(args.due_day !== undefined ? { dueDay: args.due_day } : {}),
            tagIds: priorityTagIds([], args.priority),
          }),
        });
        return ok({
          task: await api(`/tasks/${encodeURIComponent(created.id)}`),
          task_id: created.id,
          changed_fields: ['title', 'projectId', 'tagIds'],
        });
      }
      case 'update_task': {
        const current = await api(`/tasks/${encodeURIComponent(args.task_id)}`);
        const changes = {};
        if (args.title !== undefined) changes.title = args.title;
        if (args.notes !== undefined) changes.notes = args.notes;
        if (args.due_day !== undefined) changes.dueDay = args.due_day;
        if (args.project_id !== undefined) changes.projectId = args.project_id;
        if (args.priority !== undefined)
          changes.tagIds = priorityTagIds(current.tagIds || [], args.priority);
        if (!Object.keys(changes).length)
          return fail('No supported fields were supplied; task was not changed.');
        await api(`/tasks/${encodeURIComponent(args.task_id)}`, {
          method: 'PATCH',
          body: JSON.stringify(changes),
        });
        return ok({
          task: await api(`/tasks/${encodeURIComponent(args.task_id)}`),
          task_id: args.task_id,
          changed_fields: Object.keys(changes),
        });
      }
      case 'complete_task': {
        const current = await api(`/tasks/${encodeURIComponent(args.task_id)}`);
        if (current.isDone)
          return ok({ task: current, task_id: args.task_id, changed_fields: [] });
        await api(`/tasks/${encodeURIComponent(args.task_id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ isDone: true }),
        });
        return ok({
          task: await api(`/tasks/${encodeURIComponent(args.task_id)}`),
          task_id: args.task_id,
          changed_fields: ['isDone'],
        });
      }
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Unexpected adapter failure');
  }
};

const respond = (id, result, error) =>
  process.stdout.write(
    `${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`,
  );
const lineReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
lineReader.on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.method === 'notifications/initialized') return;
  if (request.method === 'initialize')
    return respond(request.id, {
      protocolVersion: request.params?.protocolVersion || '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'super-productivity-mcp', version: '0.1.0' },
    });
  if (request.method === 'tools/list') return respond(request.id, { tools });
  if (request.method === 'tools/call')
    return respond(
      request.id,
      await callTool(request.params?.name, request.params?.arguments),
    );
  if (request.id !== undefined)
    return respond(request.id, undefined, { code: -32601, message: 'Method not found' });
});
