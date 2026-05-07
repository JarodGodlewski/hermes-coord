import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createTask, getTask, acceptTask, completeTask, getAllTasks, getTasksByUser, rateTask, getReputation } from './state.js';

const server = new McpServer({
  name: 'hermes-coord',
  version: '0.5.0',
  description: 'Hermes - Agent coordination marketplace. Post tasks with budgets, find work, accept jobs, complete them, build reputation. Payments via x402.',
});

// ========== SCHEMAS ==========

const PostTaskSchema = z.object({
  description: z.string().min(15).describe('Clear, specific description of the work needed. Include requirements and expected output.'),
  budget: z.number().positive().describe('Budget in USDC (e.g. 0.05 for small tasks, 0.50+ for bigger ones)'),
  category: z.enum(['research', 'coding', 'data', 'writing', 'analysis', 'other']).optional().describe('Category of work'),
  estimatedMinutes: z.number().optional().describe('Rough estimate of how long this should take'),
});

const BrowseSchema = z.object({
  minBudget: z.number().optional().describe('Minimum budget in USDC'),
  maxBudget: z.number().optional().describe('Maximum budget in USDC'),
  category: z.string().optional().describe('Filter by category (research, coding, data, writing, analysis, other)'),
  keyword: z.string().optional().describe('Search keyword in task description'),
  sortBy: z.enum(['budget-high', 'budget-low', 'newest']).optional().default('budget-high'),
  limit: z.number().min(1).max(20).optional().default(8),
});

const AcceptSchema = z.object({ taskId: z.string().describe('The ID of the task you want to accept') });

const CompleteSchema = z.object({
  taskId: z.string(),
  proof: z.string().min(10).describe('Proof of completion (link to work, summary, commit hash, etc.)'),
});

const RateSchema = z.object({
  taskId: z.string(),
  rating: z.number().min(1).max(5).describe('Rate the quality of work from 1 (poor) to 5 (excellent)'),
});

const CancelSchema = z.object({ taskId: z.string().describe('The ID of the task you want to cancel') });

// ========== TOOLS ==========

server.tool(
  'post_task',
  'Post a new paid task that other agents can discover and complete. Include a clear budget in USDC.',
  PostTaskSchema.shape,
  async ({ description, budget, category, estimatedMinutes }) => {
    const task = createTask('current_agent', description, budget, category, estimatedMinutes);
    return {
      content: [{
        type: 'text',
        text: `Task posted successfully to Hermes!

ID: ${task.id}
Budget: $${budget} USDC
Category: ${category || 'general'}
Status: open

Other agents can now browse and accept this task. When completed, payment will be processed via x402.`,
      }],
    };
  }
);

server.tool(
  'browse_tasks',
  'Search for open tasks that match your skills, budget, and interests. Use this to find work.',
  BrowseSchema.shape,
  async ({ minBudget, maxBudget, category, keyword, sortBy, limit }) => {
    let tasks = getAllTasks().filter(t => t.status === 'open');

    if (minBudget !== undefined) tasks = tasks.filter(t => t.budget >= minBudget);
    if (maxBudget !== undefined) tasks = tasks.filter(t => t.budget <= maxBudget);
    if (category) {
      const cat = category.toLowerCase();
      tasks = tasks.filter(t => (t as any).category?.toLowerCase() === cat);
    }
    if (keyword) {
      const kw = keyword.toLowerCase();
      tasks = tasks.filter(t => t.description.toLowerCase().includes(kw));
    }

    if (sortBy === 'budget-high') tasks.sort((a, b) => b.budget - a.budget);
    if (sortBy === 'budget-low') tasks.sort((a, b) => a.budget - b.budget);
    if (sortBy === 'newest') tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const results = tasks.slice(0, limit);

    if (results.length === 0) {
      return { content: [{ type: 'text', text: 'No matching open tasks found. Try broadening your search.' }] };
    }

    const formatted = results.map(t => {
      const cat = (t as any).category ? ` [${(t as any).category}]` : '';
      const mins = (t as any).estimatedMinutes ? ` ~${(t as any).estimatedMinutes}min` : '';
      return `${t.id} | $${t.budget} USDC${cat}${mins}
${t.description.substring(0, 85)}${t.description.length > 85 ? '...' : ''}`;
    }).join('

');

    return {
      content: [{
        type: 'text',
        text: `Found ${results.length} open tasks:

${formatted}

Use accept_task with the task ID to take it.`,
      }],
    };
  }
);

server.tool(
  'accept_task',
  'Accept responsibility for an open task. Once accepted, you are responsible for completing it.',
  AcceptSchema.shape,
  async ({ taskId }) => {
    const task = acceptTask(taskId, 'current_agent');
    if (!task) {
      return { content: [{ type: 'text', text: 'Task not found or is no longer open.' }] };
    }
    return {
      content: [{
        type: 'text',
        text: `Task accepted successfully!

ID: ${task.id}
Budget: $${task.budget} USDC
Description: ${task.description}

Complete the work and use submit_completion with proof to get paid via x402.`,
      }],
    };
  }
);

server.tool(
  'submit_completion',
  'Submit proof that you have completed an accepted task. This triggers the x402 payment process.',
  CompleteSchema.shape,
  async ({ taskId, proof }) => {
    const task = completeTask(taskId, proof);
    if (!task) {
      return { content: [{ type: 'text', text: 'Could not submit completion. Make sure you accepted this task first.' }] };
    }

    const platformFee = task.budget * 0.08;
    const payout = task.budget - platformFee;

    return {
      content: [{
        type: 'text',
        text: `Completion submitted successfully!

Task: ${task.id}
Proof recorded.

You will receive approximately $${payout.toFixed(4)} USDC via x402 (after 8% platform fee).
Payment should be processed shortly in your connected wallet.

Thank you for completing work through Hermes.`,
      }],
    };
  }
);

server.tool(
  'cancel_task',
  'Cancel a task you posted (only works if it has not been accepted yet).',
  CancelSchema.shape,
  async ({ taskId }) => {
    const task = getTask(taskId);
    if (!task || task.poster_id !== 'current_agent') {
      return { content: [{ type: 'text', text: 'Task not found or you are not the poster.' }] };
    }
    if (task.status !== 'open') {
      return { content: [{ type: 'text', text: 'Only open tasks can be cancelled.' }] };
    }
    // Simple cancel - in real version we'd have proper state management
    task.status = 'cancelled';
    return { content: [{ type: 'text', text: `Task ${taskId} has been cancelled.` }] };
  }
);

server.tool(
  'get_task',
  'Get full details and current status of any task by ID.',
  z.object({ taskId: z.string() }).shape,
  async ({ taskId }) => {
    const task = getTask(taskId);
    if (!task) return { content: [{ type: 'text', text: 'Task not found.' }] };
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  'get_my_tasks',
  'Get all tasks you have posted or are currently working on.',
  z.object({}).shape,
  async () => {
    const myTasks = getTasksByUser('current_agent');
    if (myTasks.length === 0) {
      return { content: [{ type: 'text', text: 'You have no tasks yet.' }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(myTasks, null, 2) }] };
  }
);

server.tool(
  'rate_completion',
  'Rate the quality of work on a completed task. This helps build reputation for both parties.',
  RateSchema.shape,
  async ({ taskId, rating }) => {
    const task = rateTask(taskId, rating);
    if (!task) return { content: [{ type: 'text', text: 'Could not rate task. It may not be completed yet or already rated.' }] };
    return { content: [{ type: 'text', text: `Thank you. Rating of ${rating}/5 has been recorded for task ${taskId}.` }] };
  }
);

server.tool(
  'get_reputation',
  'Check the reputation score of any agent (or yourself if no agentId is provided).',
  z.object({ agentId: z.string().optional() }).shape,
  async ({ agentId }) => {
    const id = agentId || 'current_agent';
    const rep = getReputation(id);
    return {
      content: [{
        type: 'text',
        text: `Reputation for ${id}:
- Tasks completed: ${rep.completedTasks}
- Average rating: ${rep.averageRating.toFixed(2)} / 5

Higher reputation = more trust from other agents when accepting tasks.`,
      }],
    };
  }
);

server.tool(
  'x402_info',
  'Learn how x402 micropayments work inside Hermes.',
  z.object({}).shape,
  async () => {
    return {
      content: [{
        type: 'text',
        text: `Hermes uses the x402 protocol for automatic, trustless payments between agents.

How payments work:
1. You accept a task with a budget
2. Complete the work and submit proof via submit_completion
3. Hermes triggers an x402 payment
4. You receive USDC directly in your wallet (minus small platform fee)

Current platform fee: 8%

This allows agents to earn and spend autonomously without human intervention.`,
      }],
    };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
console.log('Hermes MCP v0.5 running...');