import { addNote, listNotes, addReminder, listReminders } from "./memory.js";

export const toolDefinitions = [
  {
    name: "get_current_time",
    description: "Get the current date and time.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "calculate",
    description: "Evaluate a basic arithmetic expression (+, -, *, /, parentheses, decimals).",
    input_schema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "e.g. '(2 + 3) * 4'" },
      },
      required: ["expression"],
    },
  },
  {
    name: "get_weather",
    description: "Get current weather for a city name.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. 'Paris'" },
      },
      required: ["city"],
    },
  },
  {
    name: "take_note",
    description: "Save a note to persistent memory.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "list_notes",
    description: "List all saved notes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_reminder",
    description: "Save a reminder, optionally with a time/date description.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        when: { type: "string", description: "Free-text time, e.g. 'tomorrow 9am' (not scheduled, just recorded)" },
      },
      required: ["text"],
    },
  },
  {
    name: "list_reminders",
    description: "List all saved reminders.",
    input_schema: { type: "object", properties: {} },
  },
];

// Only digits, whitespace, and + - * / ( ) . are allowed — rejects anything
// that could smuggle in JS syntax before it ever reaches Function().
const SAFE_EXPR = /^[\d\s+\-*/().]+$/;

function safeCalculate(expression) {
  if (!SAFE_EXPR.test(expression)) {
    throw new Error("Expression contains disallowed characters.");
  }
  // eslint-disable-next-line no-new-func
  const result = Function(`"use strict"; return (${expression});`)();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("Expression did not evaluate to a finite number.");
  }
  return result;
}

async function getWeather(city) {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
  );
  const geo = await geoRes.json();
  if (!geo.results || geo.results.length === 0) {
    return { error: `No location found for "${city}".` };
  }
  const { latitude, longitude, name, country } = geo.results[0];
  const wxRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code`
  );
  const wx = await wxRes.json();
  return {
    location: `${name}, ${country}`,
    temperatureC: wx.current?.temperature_2m,
    windSpeedKph: wx.current?.wind_speed_10m,
    humidityPercent: wx.current?.relative_humidity_2m,
  };
}

export async function runTool(name, input) {
  switch (name) {
    case "get_current_time":
      return { now: new Date().toString() };
    case "calculate":
      try {
        return { result: safeCalculate(input.expression) };
      } catch (err) {
        return { error: err.message };
      }
    case "get_weather":
      try {
        return await getWeather(input.city);
      } catch (err) {
        return { error: err.message };
      }
    case "take_note":
      return addNote(input.text);
    case "list_notes":
      return { notes: listNotes() };
    case "set_reminder":
      return addReminder(input.text, input.when);
    case "list_reminders":
      return { reminders: listReminders() };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
