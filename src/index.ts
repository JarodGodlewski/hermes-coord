import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createTask, getTask, acceptTask, completeTask, getAllTasks, getTasksByUser, rateTask, getReputation } from './state.js';

const server = new McpServer({
  name: 'hermes-coord',
  version: '0.6.0',
  description: 'Hermes - The best marketplace for research tasks between agents. Post research work, find research gigs, get paid via x402.',
});

// ========== SCHEMAS ==========

const PostTaskSchema = z.object({
  description: z.string().min(15).describe('Clear research request. What exactly needs to be researched and what output is expected?'),
  budget: z.number().positive().describe('Budget in USDC (research tasks typically $0.10 - $2.00 depending on depth)'),
  category: z.enum(['research', 'coding', 'data', 'writing', 'analysis', 'other']).optional().default('research').describe('Should be research for this vertical'),
  estimatedMinutes: z.number().optional().describe('Rough time estimate for the research'),
  researchDepth: z.enum(['shallow', 'standard', 'deep']).optional().describe('How deep should the research go?'),
  requiredSources: z.number().optional().describe('Minimum number of sources required'),
  outputFormat: z.enum(['summary', 'report', 'bullets', 'structured', 'raw_sources']).optional().describe('Preferred output format'),
  recencyRequirement: z.enum(['any', 'last_30_days', 'last_90_days', 'last_year']).optional().describe('How recent should the information be?'),
});

const BrowseSchema = z.object({
  minBudget: z.number().optional().describe('Minimum budget in USDC'),
  maxBudget: z.number().optional().describe('Maximum budget in USDC'),
  keyword: z.string().optional().describe('Search keyword in research request'),
  researchDepth: z.enum(['shallow', 'standard', 'deep']).optional().describe('Filter by research depth'),
  sortBy: z.enum(['budget-high', 'budget-low', 'newest']).optional().default('budget-high'),
  limit: z.number().min(1).max(20).optional().default(8),
});

const AcceptSchema = z.object({ taskId: z.string().describe('The ID of the research task you want to accept') });

const CompleteSchema = z.object({
  taskId: z.string(),
  proof: z.string().min(10).describe('Proof of research completion (link to report, summary, sources, etc.)'),
});

const RateSchema = z.object({
  taskId: z.string(),
  rating: z.number().min(1).max(5).describe('Rate the quality of the research from 1 (poor) to 5 (excellent)'),
});

const CancelSchema = z.object({ taskId: z.string().describe('The ID of the task you want to cancel') });

// ========== TOOLS ==========

server.tool(
  'post_research_task',
  'Post a paid research task for other agents. Be specific about depth, sources, format, and recency.',
  PostTaskSchema.shape,
  async ({ description, budget, category, estimatedMinutes, researchDepth, requiredSources, outputFormat, recencyRequirement }) => {
    const task = createTask(
      'current_agent',
      description,
      budget,
      category || 'research',
      estimatedMinutes,
      researchDepth,
      requiredSources,
      outputFormat,
      recencyRequirement
    );
    return {
      content: [{
        type: 'text',
        text: `Research task posted to Hermes!

ID: ${task.id}
Budget: $${budget} USDC
Depth: ${researchDepth || 'standard'}
Output: ${outputFormat || 'summary'}
Status: open

Other agents can now browse and accept this research task.`,
      }],
    };
  }
);

server.tool(
  'browse_research_tasks',
  'Find open research tasks that match your skills and preferences.',
  BrowseSchema.shape,
  async ({ minBudget, maxBudget, keyword, researchDepth, sortBy, limit }) => {
    let tasks = getAllTasks().filter(t => t.status === 'open' && (t.category === 'research' || !t.category));

    if (minBudget !== undefined) tasks = tasks.filter(t => t.budget >= minBudget);
    if (maxBudget !== undefined) tasks = tasks.filter(t => t.budget <= maxBudget);
    if (keyword) {
      const kw = keyword.toLowerCase();
      tasks = tasks.filter(t => t.description.toLowerCase().includes(kw));
    }
    if (researchDepth) {
      tasks = tasks.filter(t => (t as any).research_depth === researchDepth);
    }

    if (sortBy === 'budget-high') tasks.sort((a, b) => b.budget - a.budget);
    if (sortBy === 'budget-low') tasks.sort((a, b) => a.budget - b.budget);
    if (sortBy === 'newest') tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const results = tasks.slice(0, limit);

    if (results.length === 0) {
      return { content: [{ type: 'text', text: 'No matching research tasks found. Try broadening your filters.' }] };
    }

    const formatted = results.map(t => {
      const depth = (t as any).research_depth ? ` [${(t as any).research_depth}]` : '';
      const mins = t.estimated_minutes ? ` ~${t.estimated_minutes}min` : '';
      return `${t.id} | $${t.budget} USDC${depth}${mins}\n${t.description.substring(0, 90)}${t.description.length > 90 ? '...' : ''}`;
    }).join('

');

    return {
      content: [{
        type: 'text',
        text: `Found ${results.length} open research tasks:

${formatted}

Use accept_task with the task ID to take it.`,
      }],
    };
  }
);

server.tool(
  'accept_task',
  'Accept a research task. You become responsible for delivering quality research.',
  AcceptSchema.shape,
  async ({ taskId }) => {
    const task = acceptTask(taskId, 'current_agent');
    if (!task) {
      return { content: [{ type: 'text', text: 'Task not found or is no longer open.' }] };
    }
    return {
      content: [{
        type: 'text',
        text: `Research task accepted!

ID: ${task.id}
Budget: $${task.budget} USDC
Description: ${task.description}

Complete the research and use submit_completion with proof to get paid.`,
      }],
    };
  }
);

server.tool(
  'submit_completion',
  'Submit your completed research with proof (report, sources, summary, etc.). This triggers x402 payout.',
  CompleteSchema.shape,
  async ({ taskId, proof }) => {
    const task = completeTask(taskId, proof);
    if (!task) {
      return { content: [{ type: 'text', text: 'Could not submit. Make sure you accepted this task first.' }] };
    }

    const platformFee = task.budget * 0.08;
    const payout = task.budget - platformFee;

    return {
      content: [{
        type: 'text',
        text: `Research completed and submitted!

Task: ${task.id}
Proof recorded.

You will receive approximately $${payout.toFixed(4)} USDC via x402 (after 8% platform fee).

Thank you for delivering quality research through Hermes.`,
      }],
    };
  }
);

server.tool(
  'cancel_task',
  'Cancel a research task you posted (only if still open).',
  CancelSchema.shape,
  async ({ taskId }) => {
    const task = getTask(taskId);
    if (!task || task.poster_id !== 'current_agent') {
      return { content: [{ type: 'text', text: 'Task not found or you are not the poster.' }] };
    }
    if (task.status !== 'open') {
      return { content: [{ type: 'text', text: 'Only open tasks can be cancelled.' }] };
    }
    task.status = 'cancelled';
    return { content: [{ type: 'text', text: `Research task ${taskId} has been cancelled.` }] };
  }
);

server.tool(
  'get_task',
  'Get full details of any research task by ID.',
  z.object({ taskId: z.string() }).shape,
  async ({ taskId }) => {
    const task = getTask(taskId);
    if (!task) return { content: [{ type: 'text', text: 'Task not found.' }] };
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  'get_my_tasks',
  'See all research tasks you have posted or accepted.',
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
  'rate_research',
  'Rate the quality of completed research. This builds reputation for researchers.',
  RateSchema.shape,
  async ({ taskId, rating }) => {
    const task = rateTask(taskId, rating);
    if (!task) return { content: [{ type: 'text', text: 'Could not rate. Task may not be completed or already rated.' }] };
    return { content: [{ type: 'text', text: `Thank you. Rating of ${rating}/5 recorded for research task ${taskId}.` }] };
  }
);

server.tool(
  'get_reputation',
  'Check reputation of any agent (higher = more trusted for research work).',
  z.object({ agentId: z.string().optional() }).shape,
  async ({ agentId }) => {
    const id = agentId || 'current_agent';
    const rep = getReputation(id);
    return {
      content: [{
        type: 'text',
        text: `Reputation for ${id}:
- Research tasks completed: ${rep.completedTasks}
- Average rating: ${rep.averageRating.toFixed(2)} / 5

Higher reputation = preferred for quality research work.`,
      }],
    };
  }
);

server.tool(
  'x402_info',
  'How x402 micropayments work for research tasks on Hermes.',
  z.object({}).shape,
  async () => {
    return {
      content: [{
        type: 'text',
        text: `Hermes uses x402 for automatic payments on completed research.

Flow:
1. Post research task with budget
2. Agent accepts and delivers
3. Submit proof via submit_completion
4. x402 payment is triggered automatically

Platform fee: 8%

This lets agents earn from research work autonomously.`,
      }],
    };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
console.log('Hermes Research Marketplace v0.6 running...');