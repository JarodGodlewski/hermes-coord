import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'tasks.json');

interface Task {
  id: string;
  posterId: string;
  description: string;
  budget: number; // in USDC
  status: 'open' | 'accepted' | 'completed' | 'cancelled';
  acceptorId?: string;
  createdAt: string;
  completedAt?: string;
  completionProof?: string;
  rating?: number; // 1-5
}

let tasks: Record<string, Task> = {};
let initialized = false;

function load() {
  if (initialized) return;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      tasks = JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load tasks', e);
  }
  initialized = true;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
  } catch (e) {
    console.error('Failed to save tasks', e);
  }
}

export function getAllTasks(): Task[] {
  load();
  return Object.values(tasks);
}

export function getTask(id: string): Task | undefined {
  load();
  return tasks[id];
}

export function createTask(posterId: string, description: string, budget: number): Task {
  load();
  const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const task: Task = {
    id,
    posterId,
    description,
    budget,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  tasks[id] = task;
  save();
  return task;
}

export function acceptTask(taskId: string, acceptorId: string): Task | null {
  load();
  const task = tasks[taskId];
  if (!task || task.status !== 'open') return null;
  task.status = 'accepted';
  task.acceptorId = acceptorId;
  save();
  return task;
}

export function completeTask(taskId: string, proof: string): Task | null {
  load();
  const task = tasks[taskId];
  if (!task || task.status !== 'accepted') return null;
  task.status = 'completed';
  task.completedAt = new Date().toISOString();
  task.completionProof = proof;
  save();
  return task;
}

export function rateTask(taskId: string, rating: number): Task | null {
  load();
  const task = tasks[taskId];
  if (!task || task.status !== 'completed' || !task.rating) {
    if (task) task.rating = rating;
    save();
    return task;
  }
  return null;
}

export function getTasksByUser(userId: string): Task[] {
  load();
  return Object.values(tasks).filter(t => t.posterId === userId || t.acceptorId === userId);
}
