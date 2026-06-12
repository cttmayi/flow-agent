# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — Run all tests (uses Node.js built-in `node --test`)
- `flow-agent run <name>` — Execute a saved workflow from `.flow-agent/workflows/<name>.js`
- `flow-agent generate <name> "<desc>"` — Generate a DSN-JS workflow file from a description
- `flow-agent generate-run <name> "<desc>"` — Generate and immediately execute
- `npm link` — Register `flow-agent` as a global CLI command

## Architecture

This is a **DSN-JS Dynamic Workflow Agent Runtime** — a sandboxed Node.js runtime that executes AI-driven workflow scripts via Anthropic SDK.

### Data flow

```
cli.js → engine.js → executor.js → sandbox.js (vm)
                                     ├── agent()      → Anthropic API + tool_use loop
                                     ├── parallel()   → concurrent async task runner
                                     ├── phase()      → log phase markers
                                     └── checkpoint() → in-memory cache
```

### Key architectural boundaries

- **Workflow code runs in a Node.js `vm` sandbox** — no `fs`, `path`, `process`, or `require`. Only 4 globals are injected: `agent`, `parallel`, `phase`, `checkpoint`.
- **All external interaction goes through `agent()` tool_use** — workflows cannot directly access filesystem, network, or process. They must delegate via agent calls with tool names like `"bash"` and `"read"`.
- **Tool system**: `ToolRegistry` (lib/tools/registry.js) maps tool names → Anthropic-compatible schemas. Tools are files in `lib/tools/` exporting `{ name, description, parameters, execute }`.
- **API implementations** live in `lib/api/` — `agent.js` wraps the Anthropic SDK with a tool_use loop (max 10 rounds), `parallel.js` is an async concurrency controller, `phase.js` is a logger, `checkpoint.js` is an in-memory key-value cache.
- **Config** is loaded from `.flow-agent/config.yaml` via a hand-rolled YAML parser in `lib/config.js`. Falls back to empty config. API key resolution: config file > env var > placeholder key for proxy mode.
- **DSN-JS system prompt** (`lib/prompts/dsnjs-system.md`) is given to the LLM when generating workflows — it defines the sandbox constraints and API usage rules.
- **Proxy mode**: Setting a placeholder API key (`sk-ant-placeholder`) strips the `x-api-key` header, for use with local proxy servers.

### Module entry points

- `runtime.js` — Public API exports for programmatic use
- `cli.js` — CLI entry, registered as `flow-agent` binary
- `lib/engine.js` — Core engine: creates tool registry, loads config, manages workflow run/generate/execute

### Testing

Tests use Node.js built-in `node:test` and `node:assert` (no third-party test framework). Each test file covers one module. Example: `node --test tests/sandbox.test.js` runs a single test file.
