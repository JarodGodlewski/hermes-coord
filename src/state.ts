import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'hermes.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Initialize tables with research-specific fields
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    poster_id TEXT NOT NULL,
    description TEXT NOT NULL,
    budget REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    acceptor_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    completion_proof TEXT,
    rating INTEGER,
    category TEXT,
    estimated_minutes INTEGER,
    -- Research-specific fields
    research_depth TEXT,
    required_sources INTEGER,
    output_format TEXT,
    recency_requirement TEXT
  );

  CREATE TABLE IF NOT EXISTS reputation (
    agent_id TEXT PRIMARY KEY,
    completed_tasks INTEGER DEFAULT 0,
    total_rating INTEGER DEFAULT 0,
    average_rating REAL DEFAULT 0
  );
`);

// Prepared statements
const insertTask = db.prepare(`
  INSERT INTO tasks (
    id, poster_id, description, budget, status, created_at,
    category, estimated_minutes, research_depth, required_sources, output_format, recency_requirement
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getTaskById = db.prepare('SELECT * FROM tasks WHERE id = ?');
const getAllOpenTasks = db.prepare("SELECT * FROM tasks WHERE status = 'open'");
const updateTaskStatus = db.prepare('UPDATE tasks SET status = ?, acceptor_id = ? WHERE id = ?');
const completeTaskStmt = db.prepare('UPDATE tasks SET status = ?, completed_at = ?, completion_proof = ? WHERE id = ?');
const rateTaskStmt = db.prepare('UPDATE tasks SET rating = ? WHERE id = ?');

const getReputationStmt = db.prepare('SELECT * FROM reputation WHERE agent_id = ?');
const upsertReputation = db.prepare(`
  INSERT INTO reputation (agent_id, completed_tasks, total_rating, average_rating)
  VALUES (?, 1, ?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET
    completed_tasks = completed_tasks + 1,
    total_rating = total_rating + excluded.total_rating,
    average_rating = (total_rating + excluded.total_rating) / (completed_tasks + 1)
`);

const getTasksByUserStmt = db.prepare(`
  SELECT * FROM tasks WHERE poster_id = ? OR acceptor_id = ?
`);

// Types
export interface Task {
  id: string;
  poster_id: string;
  description: string;
  budget: number;
  status: 'open' | 'accepted' | 'completed' | 'cancelled';
  acceptor_id?: string;
  created_at: string;
  completed_at?: string;
  completion_proof?: string;
  rating?: number;
  category?: string;
  estimated_minutes?: number;
  // Research-specific
  research_depth?: string;
  required_sources?: number;
  output_format?: string;
  recency_requirement?: string;
}

export interface Reputation {
  completed_tasks: number;
  average_rating: number;
}

// Public API
export function createTask(
  posterId: string,
  description: string,
  budget: number,
  category?: string,
  estimatedMinutes?: number,
  researchDepth?: string,
  requiredSources?: number,
  outputFormat?: string,
  recencyRequirement?: string
): Task {
  const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date().toISOString();

  insertTask.run(
    id,
    posterId,
    description,
    budget,
    'open',
    createdAt,
    category || null,
    estimatedMinutes || null,
    researchDepth || null,
    requiredSources || null,
    outputFormat || null,
    recencyRequirement || null
  );

  return getTaskById.get(id) as Task;
}

export function getTask(id: string): Task | undefined {
  return getTaskById.get(id) as Task | undefined;
}

export function getAllTasks(): Task[] {
  return getAllOpenTasks.all() as Task[];
}

export function acceptTask(taskId: string, acceptorId: string): Task | null {
  const task = getTaskById.get(taskId) as Task | undefined;
  if (!task || task.status !== 'open') return null;

  updateTaskStatus.run('accepted', acceptorId, taskId);
  return getTaskById.get(taskId) as Task;
}

export function completeTask(taskId: string, proof: string): Task | null {
  const task = getTaskById.get(taskId) as Task | undefined;
  if (!task || task.status !== 'accepted') return null;

  const completedAt = new Date().toISOString();
  completeTaskStmt.run('completed', completedAt, proof, taskId);
  return getTaskById.get(taskId) as Task;
}

export function rateTask(taskId: string, rating: number): Task | null {
  const task = getTaskById.get(taskId) as Task | undefined;
  if (!task || task.status !== 'completed') return null;

  rateTaskStmt.run(rating, taskId);

  if (task.acceptor_id) {
    upsertReputation.run(task.acceptor_id, rating, rating);
  }

  return getTaskById.get(taskId) as Task;
}

export function getTasksByUser(userId: string): Task[] {
  return getTasksByUserStmt.all(userId, userId) as Task[];
}

export function getReputation(agentId: string): Reputation {
  const row = getReputationStmt.get(agentId) as any;
  if (!row) {
    return { completed_tasks: 0, average_rating: 0 };
  }
  return {
    completed_tasks: row.completed_tasks,
    average_rating: row.average_rating,
  };
}
