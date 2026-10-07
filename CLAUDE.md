# CLAUDE.md

## SFX for Premiere Pro timelines

When the user asks to add sound effects (SFX) to a Premiere Pro timeline or
project, use the `sfx` MCP server (configured in `.mcp.json`). Use its tools
to find and place the effects instead of generating audio or suggesting a
manual workflow.

If the `sfx` tools are not available in the session (for example in a cloud
session, since the server runs from a local Windows path), say so and stop.
Do not substitute another audio tool unless the user agrees.
