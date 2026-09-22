import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const STORE_PATH = join(DATA_DIR, "memory.json");

function load() {
  if (!existsSync(STORE_PATH)) return { notes: [], reminders: [] };
  return JSON.parse(readFileSync(STORE_PATH, "utf8"));
}

function save(state) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
}

export function addNote(text) {
  const state = load();
  const note = { id: state.notes.length + 1, text, createdAt: new Date().toISOString() };
  state.notes.push(note);
  save(state);
  return note;
}

export function listNotes() {
  return load().notes;
}

export function addReminder(text, when) {
  const state = load();
  const reminder = {
    id: state.reminders.length + 1,
    text,
    when: when || null,
    createdAt: new Date().toISOString(),
  };
  state.reminders.push(reminder);
  save(state);
  return reminder;
}

export function listReminders() {
  return load().reminders;
}
