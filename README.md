# TickList

A TickTick-inspired task manager: React + TypeScript client, Node/Express + SQLite API with real user accounts (JWT auth), built to run as a client-server app so multiple devices can sync against one backend.

## What's implemented

- Accounts: register/login (bcrypt + JWT), per-user data isolation
- Lists (with a default Inbox), custom lists
- Tasks: title, notes, due date, priority, subtasks
- Recurring tasks (daily/weekly/monthly/yearly) — completing one auto-creates the next occurrence
- Tags and tag filtering
- Smart lists: Today, Next 7 Days, High Priority, All Tasks
- Calendar (month) view
- Real backend: syncing across devices works once the server is deployed somewhere reachable (see below)

## Not implemented (explicitly deferred, not TickTick features I forgot)

Pomodoro timer, habit tracking, Eisenhower matrix, collaboration/sharing, push notifications, natural-language date parsing, themes, widgets, native mobile/desktop apps.

## Running locally

```bash
# backend
cd server
npm install
JWT_SECRET=some-long-random-string npm run dev   # http://localhost:4000

# frontend (separate terminal)
cd client
npm install
npm run dev   # http://localhost:5173, talks to http://localhost:4000/api by default
```

Set `VITE_API_URL` (see `client/.env.example`) if the API isn't on `localhost:4000`.

## Deploying (required for real multi-device sync)

The server is a stateless Express app + SQLite file — deploy it to any Node host (Render, Fly.io, Railway, a VPS, etc.), set a strong `JWT_SECRET`, and point the client's `VITE_API_URL` at it. This step needs your own hosting account/credentials — it isn't something that can be provisioned from here.

## Path to an App Store app

The client is a plain React web app today. To ship it as a native iOS/Android app later, wrap it with Capacitor or rebuild the UI in React Native, both of which can reuse this same REST API unchanged. That path needs an Apple Developer account (yours, $99/yr) and either a macOS build machine or a cloud build service (e.g. Expo EAS) — not something this environment can do end-to-end.
