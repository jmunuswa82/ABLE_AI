# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   ├── als-studio/         # React + Vite frontend (DAW UI)
│   └── mockup-sandbox/     # Component preview server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── services/               # Python analysis pipeline
│   └── als_parser/         # ALS file parser + analysis engine
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health`
- Job Runner: `src/lib/job-runner.ts` — orchestrates Python pipeline, creates artifacts + ALS Patch Package ZIP
- Depends on: `@workspace/db`, `@workspace/api-zod`, `archiver`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle
- Build bundles an allowlist of deps and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- Tables: projects, jobs, parse_results (JSONB project_graph), completion_plans (JSONB plan_data), artifact_files
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec. Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/als-studio` (`@workspace/als-studio`)

React + Vite frontend. Dark DAW-inspired UI with violet/purple accent.

- Pages:
  - **Dashboard**: Upload form, project grid, live polling for job status
  - **ProjectDetail**: Stat cards, track list, job history, quick-nav buttons
  - **TimelineView**: DAW-style clip timeline with multi-view modes (Arrange, Automation, Sidechain), zoom controls, automation lane visualization (SVG), sidechain relationship map, track inspector panel
  - **CompletionPlanView**: Action cards by priority/category with filter tabs
  - **ExportView**: Artifact download cards with type-specific icons/colors, ALS Patch Package hero section
- Components: Layout.tsx (sidebar nav with project sub-nav)
- Hooks: use-polling.ts (polls project status every 2s when jobs are running)
- Store: lib/store.ts (Zustand: selectedTrackId, selectedSectionId)
- Utils: lib/utils.ts (cn, formatScore, formatBars, getStatusColor, getRoleColor, formatBytes)
- Styling: Dark DAW theme in index.css, always dark-mode, violet primary accent (--primary: 262 52% 58%)
- Routing: wouter with BASE_URL base
- API client: @workspace/api-client-react (generated React Query hooks)

### `services/als_parser` (Python)

Python analysis pipeline for ALS files.

- `parser.py` — gzip decompress + lxml XML parse of .als files. Extracts:
  - Track structure (audio/midi/group/return/master)
  - Clips with position, type, content summary
  - Devices with plugin info and inferred purpose
  - Automation envelopes with parameter names, density, shape classification
  - Track routing (audio input/output, sends)
  - Sidechain detection (heuristic: compressor on bass/lead near kick)
  - Locator markers
- `role_inference.py` — infer track role (kick, bass, lead, pad, fx, etc.)
- `style_inference.py` — infer musical genre/style tags
- `section_inference.py` — detect arrangement sections (Intro, Build, Peak, etc.)
- `weakness_detection.py` — detect production weaknesses
- `completion_engine.py` — generate ranked completion actions
- `pipeline.py` — orchestrate full pipeline
- `run_pipeline.py` — CLI entry point (Node.js spawns as child_process)
- `models.py` — data models (ProjectGraph, TrackNode, ClipNode, DeviceNode, AutomationLane, SidechainLink, etc.)

### Export System

The job runner produces these artifact types:
- `original_als` — Original uploaded .als file
- `project_graph` — JSON: parsed project structure
- `completion_plan` — JSON: AI completion plan with ranked actions
- `instructions` — Markdown: human-readable completion guide
- `patch_package` — ZIP: complete bundle with original .als + all analysis artifacts + manifest + README

Storage: `/storage/uploads` (ALS files), `/storage/artifacts/{projectId}/` (JSON outputs, ZIP)

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
