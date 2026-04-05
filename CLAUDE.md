# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (run from `frontend/`)
```bash
pnpm run dev              # Dev server — port 3000
pnpm run build            # tsc + vite build
pnpm run lint             # ESLint
pnpm run test             # Vitest unit tests
pnpm run test -- path/to/file.test.ts         # Single file
pnpm run test -- -t "test name pattern"       # Tests matching name
pnpm run test:e2e         # Playwright E2E tests
```

### Backend (run from `backend/`)
```bash
uv sync                   # Install dependencies (first time)
uv run python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
uv run pytest                                                              # All tests
uv run pytest tests/test_foo.py                                            # Single file
uv run pytest tests/test_foo.py::TestClass::test_name                     # Single test
uv run pytest -m "not slow"                                                # Skip slow tests
uv run black . && uv run isort .   # Format
uv run flake8 .                    # Lint
uv add <pkg> / uv add --dev <pkg> / uv remove <pkg>  # Manage deps
```

See `AGENTS.md` for the full style guide and additional notes.

---

## Architecture

### Stack
| Layer | Technology |
|---|---|
| Frontend | React 18 SPA, Vite, React Router v6, TanStack Query v5, Clerk React — port 3000 |
| Backend | FastAPI, MongoDB (Motor async driver), Clerk JWT auth — port 8000 |
| Auth / IdP | Clerk — RS256 JWTs validated on every backend request |
| Package managers | `pnpm` (frontend), `uv` (backend) |

The Vite dev server proxies `/api` → `http://localhost:8000`, so the frontend always calls relative `/api/v1/...` paths.

---

### Multi-Tenancy: Tutor = Tenant

Every MongoDB document carries a `tutor_id` field equal to the **tutor's Clerk user ID**. This is the tenant key for all data isolation:

- Tutors own students, assignments, questions, subjects, materials, and groups.
- Students and parents are linked to a specific tutor via `tutor_id`.
- All service-layer queries include a `tutor_id` filter; the auth layer provides it.
- Super admins use admin-specific routes that bypass this filter.

---

### Backend Request Lifecycle

1. A request hits a route in `backend/app/api/v1/endpoints/`.
2. `Depends(get_current_user)` in `backend/app/core/enhanced_auth.py` runs:
   - Validates the Clerk JWT (RS256, JWKS cached hourly in `_jwks_cache`).
   - Fetches the user from MongoDB via `_get_user_from_database()` — fires three `find_one` queries concurrently with `asyncio.gather` across `tutors`, `students`, `parents`. Result cached 60 s (`_user_db_cache` TTLCache).
   - Constructs a `ClerkUserContext` carrying `role`, `tutor_id`, `student_ids`, and admin permissions.
   - Writes the user back to Mongo via `_sync_user_to_database()` — throttled to at most once per 5 min per user (`_user_sync_cache` TTLCache).
   - If the request includes an `X-LearnTrack-Impersonation-Session` header, `_apply_impersonation_session_override()` swaps the active context to the target user.
3. The route handler receives a typed `ClerkUserContext`; it uses `tutor_id` to scope all DB queries.
4. Business logic lives in **service classes** under `backend/app/services/`. Endpoints are thin wrappers around service calls.

**Dependency shortcuts** (use these in route signatures):
- `Depends(get_current_user)` — any authenticated user
- `Depends(require_tutor)` — tutors + super admins
- `Depends(require_student)` / `Depends(require_parent)` — role-specific
- `Depends(require_super_admin)` — super admin only
- `Depends(require_admin_permission(AdminPermission.X))` — super admin + specific permission

---

### Frontend Auth & Data Flow

- **`UserContext`** (`frontend/src/contexts/UserContext.tsx`) calls `/api/v1/users/me` after Clerk auth resolves. It exposes `role`, `tutorId`, `isSuperAdmin`, and `hasAdminPermission(perm)` to the whole app.
- **`ApiClient`** (`frontend/src/lib/api-client.ts`) is the single HTTP client. Obtain it via the `useApiClient()` hook; it auto-injects the Clerk JWT Bearer token and, when active, the impersonation session header.
- All data fetching uses **TanStack Query hooks** in `frontend/src/hooks/`. Components never call `ApiClient` directly — they call a hook.

---

### Role-Based Dashboard Routing

`DashboardPage` reads the role from `UserContext` and renders `TutorDashboard`, `StudentDashboard`, or `ParentDashboard`. Each dashboard defines its own nested `<Routes>` tree.

The **Tutor Dashboard** is the most complex — it has 13+ nested views covering assignments (create, list, grade, templates), students, groups, content generation/review/bank, materials, messages, and invitations.

Admin routes live under `/admin/*` and are guarded by `AdminProtectedRoute`, which checks `isSuperAdmin` plus an optional `requiredPermission` prop mapped to `AdminPermission` enum values.

---

### Impersonation

- Admin starts a session via `POST /api/v1/admin/impersonation/start`; the session is stored **in-memory** in `backend/app/core/impersonation_store.py` with a 1-hour TTL. ⚠️ Not persisted — not suitable for multi-instance deployments.
- The frontend stores the session ID in `localStorage` and injects it as `X-LearnTrack-Impersonation-Session` via `ImpersonationContext` (`frontend/src/contexts/ImpersonationContext.tsx`), which also validates the session every 60 s.
- `get_current_user` calls `_apply_impersonation_session_override()` on every request, swapping the user context when a valid session ID is present.
- `ImpersonationBanner` (always rendered outside `<Routes>`) shows the impersonated user, a countdown, and an end-session button.

---

### AI / Question Generation

- A **LangGraph multi-node agent graph** lives in `backend/app/agents/`. Nodes: routing → retrieval → generation → validation → editing → analysis. Results stream to the frontend via SSE at `/api/v1/question-generator/stream`.
- Each tenant can configure which AI provider and model to use via `TenantAiConfigService` and the `/api/v1/admin/tenant-ai-config` endpoints. Supported providers: OpenAI, Anthropic (Claude), Google Gemini, Groq.
- AI usage cost is tracked per request in the `cost_tracking` MongoDB collection.

---

### Key Non-Obvious Patterns

- **Static routes before dynamic routes**: FastAPI resolves routes top-to-bottom. Always register literal paths (`/me`, `/pending`, `/active`) before parameterised paths (`/{id}`) in the same router, or FastAPI will match the literal string as an ID and return 422/404.
- **`@/` import alias**: Maps to `frontend/src/`. Use for all non-relative internal imports.
- **Soft deletes**: Most entities use `status = "deleted"` rather than actual removal. Filter these out in queries.
- **`cn()` for Tailwind**: Use `cn()` from `@/lib/utils` (wraps `clsx` + `tailwind-merge`) whenever combining conditional Tailwind class strings.
- **Named export lazy-loading**: Admin pages and `AdminLayout` are named exports. Use `.then(m => ({ default: m.ExportName }))` with `React.lazy()`.
- **`public_metadata` truthiness**: The JWT `public_metadata` field defaults to `{}` (empty dict) when not set — this is valid. In Python, check `metadata is None` (not `not metadata`) to avoid false-triggers on the Clerk API.
