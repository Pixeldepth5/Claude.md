export interface User {
  id: string;
  email: string;
  name: string;
}

export interface TaskList {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_inbox: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type RecurringFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface Task {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes: string;
  dueDate: string | null;
  priority: number;
  recurringFreq: RecurringFreq | null;
  recurringInterval: number | null;
  isCompleted: boolean;
  completedAt: string | null;
  isUrgent: boolean;
  isImportant: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

export type SmartView = "all" | "today" | "next7" | "priority";

export interface Habit {
  id: string;
  name: string;
  color: string;
  frequency: "daily" | "custom";
  daysOfWeek: number[] | null;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
  checkins: string[];
  streak: number;
}
