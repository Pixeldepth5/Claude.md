import type { Tag, Task, TaskList, User } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

let authToken: string | null = localStorage.getItem("token");

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

export function getAuthToken() {
  return authToken;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? `Request failed with status ${res.status}`);
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string, name: string) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ user: User }>("/auth/me"),

  getLists: () => request<{ lists: TaskList[] }>("/lists"),
  createList: (name: string, color?: string) =>
    request<{ list: TaskList }>("/lists", { method: "POST", body: JSON.stringify({ name, color }) }),
  updateList: (id: string, patch: Partial<Pick<TaskList, "name" | "color" | "sort_order">>) =>
    request<{ list: TaskList }>(`/lists/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteList: (id: string) => request<void>(`/lists/${id}`, { method: "DELETE" }),

  getTags: () => request<{ tags: Tag[] }>("/tags"),
  createTag: (name: string, color?: string) =>
    request<{ tag: Tag }>("/tags", { method: "POST", body: JSON.stringify({ name, color }) }),
  deleteTag: (id: string) => request<void>(`/tags/${id}`, { method: "DELETE" }),

  getTasks: (params: { listId?: string; tag?: string; smart?: string; includeCompleted?: boolean }) => {
    const search = new URLSearchParams();
    if (params.listId) search.set("listId", params.listId);
    if (params.tag) search.set("tag", params.tag);
    if (params.smart) search.set("smart", params.smart);
    if (params.includeCompleted) search.set("includeCompleted", "true");
    return request<{ tasks: Task[] }>(`/tasks?${search.toString()}`);
  },
  createTask: (input: {
    listId: string;
    title: string;
    notes?: string;
    dueDate?: string | null;
    priority?: number;
    parentId?: string;
    recurringFreq?: string | null;
    recurringInterval?: number | null;
    tagIds?: string[];
  }) => request<{ task: Task }>("/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (
    id: string,
    patch: Partial<{
      title: string;
      notes: string;
      dueDate: string | null;
      priority: number;
      listId: string;
      recurringFreq: string | null;
      recurringInterval: number | null;
      tagIds: string[];
      sortOrder: number;
    }>
  ) => request<{ task: Task }>(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  completeTask: (id: string) =>
    request<{ task: Task; nextOccurrence: Task | null }>(`/tasks/${id}/complete`, { method: "POST" }),
  uncompleteTask: (id: string) => request<{ task: Task }>(`/tasks/${id}/uncomplete`, { method: "POST" }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
};

export { ApiError };
