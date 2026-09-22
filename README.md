# Jarvis

A text-based personal assistant built on the Claude API with real tool use.
It is a chatbot with tools, not an ambient voice assistant — see "What this
is not" below.

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # your own key
npm start
```

## What it can do

- Answer questions and hold a conversation (Claude does the reasoning).
- `get_current_time` — real system time.
- `calculate` — arithmetic via a restricted expression evaluator.
- `get_weather` — live weather for a city (Open-Meteo, no API key needed).
- `take_note` / `list_notes` — persisted to `data/memory.json`.
- `set_reminder` / `list_reminders` — persisted; these are records, not
  scheduled alerts (nothing pings you — the assistant only recalls them
  when asked, since there's no background process or notification system).

## What this is not

- No voice input/output, no wake word, no always-listening mode.
- No device/home integration.
- No proactive behavior — it only responds when you type.

Any of those are separate, larger projects (speech-to-text/TTS pipeline,
a daemon + notification system, device APIs) built on top of this base.

## Config

- `ANTHROPIC_API_KEY` (required)
- `JARVIS_MODEL` (optional, defaults to `claude-sonnet-5`)
