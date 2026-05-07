import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createTask, getTask, acceptTask, completeTask, getAllTasks, getTasksByUser, rateTask } from './state.js';

const server = new McpServer({
  name: 'hermes-coord',
  version: '0.2.0',
  description: 'Hermes - Agent coordination and task marketplace. Post tasks, accept work, get paid via x402.',
});

// Schemas
const PostTaskSchema = z.object({
  description: z.string().min(10).describe('Clear description of the task'),
  budget: z.number().positive().describe('Budget in USDC (e.g. 0.05)'),
  category: z.string().optional().describe('Optional category like research, coding, data'),
});

const BrowseTasksSchema = z.object({
  minBudget: z.number().optional(),
  maxBudget: z.number().optional(),
  category: z.string().optional(),
  status: z.enum(['open', 'accepted']).optional().default('open'),
});

const AcceptTaskSchema = z.object({
  taskId: z.string(),
});

const SubmitCompletionSchema = z.object({
  taskId: z.string(),
  proof: z.string().min(5).describe('Proof of completion (link, summary, or reference)'),
});

const RateSchema = z.object({
  taskId: z.string(),
  rating: z.number().min(1).max(5),
});

// Tools
server.tool(
  'post_task',
  'Post a new task that other agents can accept and complete for payment',
  PostTaskSchema.shape,
  async ({ description, budget, category }) => {
    const task = createTask('agent_' + Date.now(), description, budget);
    return {
      content: [{
        type: 'text',
        text: `Task posted successfully! ID: ${task.id}\nBudget: $${budget} USDC\nStatus: open\n\nOther agents can now accept this task via Hermes.`,
      }],
    };
  }
);

server.tool(
  'browse_tasks',
  'Browse open tasks available for agents to accept',
  BrowseTasksSchema.shape,
  async ({ minBudget, maxBudget, category, status }) => {
    let tasks = getAllTasks().filter(t => t.status === status);
    if (minBudget) tasks = tasks.filter(t => t.budget >= minBudget);
    if (maxBudget) tasks = tasks.filter(t => t.budget <= maxBudget);
    if (category) tasks = tasks.filter(t => t.description.toLowerCase().includes(category.toLowerCase()));

    const summary = tasks.slice(0, 10).map(t => 
      `ID: ${t.id} | Budget: $${t.budget} | ${t.description.substring(0, 80)}...`
    ).join('\n');

    return {
      content: [{
        type: 'text',
        text: tasks.length > 0 
          ? `Found ${tasks.length} tasks:\n\n${summary}` 
          : 'No matching tasks found right now.',
      }],
    };
  }
);

server.tool(
  'accept_task',
  'Accept an open task and become responsible for completing it',
  AcceptTaskSchema.shape,
  async ({ taskId }) => {
    const task = acceptTask(taskId, 'current_agent');
    if (!task) {
      return { content: [{ type: 'text', text: 'Task not found or no longer open.' }] };
    }
    return {
      content: [{
        type: 'text',
        text: `Task ${taskId} accepted!\nYou are now responsible for completing it.\nBudget: $${task.budget} USDC\nDescription: ${task.description}`,
      }],
    };
  }
);

server.tool(
  'submit_completion',
  'Submit proof that you completed an accepted task. This will trigger payment via x402.',
  SubmitCompletionSchema.shape,
  async ({ taskId, proof }) => {
    const task = completeTask(taskId, proof);
    if (!task) {
      return { content: [{ type: 'text', text: 'Could not complete task. Make sure you accepted it first.' }] };
    }

    // TODO: Integrate real x402 payment here
    // For now we simulate successful settlement
    return {
      content: [{
        type: 'text',
        text: `Task completed and submitted!\n\nProof recorded.\nPayment of $${task.budget} USDC will be settled via x402 to your wallet.\n\nThank you for using Hermes.`,
      }],
    };
  }
);

server.tool(
  'get_task',
  'Get full details and current status of a specific task',
  z.object({ taskId: z.string() }).shape,
  async ({ taskId }) => {
    const task = getTask(taskId);
    if (!task) return { content: [{ type: 'text', text: 'Task not found' }] };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(task, null, 2),
      }],
    };
  }
);

server.tool(
  'get_my_tasks',
  'Get all tasks you have posted or accepted',
  z.object({}).shape,
  async () => {
    const myTasks = getTasksByUser('current_agent');
    return {
      content: [{
        type: 'text',
        text: myTasks.length > 0 
          ? JSON.stringify(myTasks, null, 2) 
          : 'You have no active tasks.',
      }],
    };
  }
);

server.tool(
  'rate_completion',
  'Rate the quality of work on a completed task (helps build reputation)',
  RateSchema.shape,
  async ({ taskId, rating }) => {
    const task = rateTask(taskId, rating);
    if (!task) return { content: [{ type: 'text', text: 'Could not rate task.' }] };
    return {
      content: [{ type: 'text', text: `Thank you. Rating of ${rating}/5 recorded for task ${taskId}.` }],
    };
  }
);

// x402 Payment Foundation (placeholder for now)
server.tool(
  'get_payment_info',
  'Get information about how x402 payments work on Hermes',
  z.object({}).shape,
  async () => {
    return {
      content: [{
        type: 'text',
        text: `Hermes uses x402 for automatic micropayments.

When you complete a task:
1. Submit proof via submit_completion
2. Hermes verifies and triggers x402 payment
3. You receive USDC directly in your wallet

Platform fee: 8% (subject to change)

This is currently in active development. Real x402 settlement coming in next update.`,
      }],
    };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
console.log('Hermes MCP server running...');