# LearnTrack MVP

A learning management system for tutors, students, and parents — with AI-powered question generation.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, TanStack Query, Tailwind CSS |
| Backend | FastAPI, MongoDB (Motor), LangGraph |
| Auth | Clerk (RS256 JWTs) |
| AI | OpenAI, Anthropic, Google Gemini, Groq |

## Getting Started

### Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io/)
- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- MongoDB (local or [Atlas](https://www.mongodb.com/atlas))
- [Clerk](https://clerk.com/) account

### Setup

```bash
git clone <repository-url>
cd learntrack-mvp
```

Copy the example env files and fill in your values:

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Install dependencies:

```bash
# Frontend
cd frontend && pnpm install

# Backend
cd backend && uv sync
```

### Run

```bash
# Terminal 1 — Backend
cd backend
uv run python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — Frontend
cd frontend
pnpm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Testing

```bash
# Frontend
cd frontend && pnpm test

# Backend
cd backend && uv run pytest
```

## Deployment

- **Frontend** deploys to Vercel
- **Backend** deploys to Render (Docker) — see `render.yaml`
- CI runs on GitHub Actions — Render auto-deploys after checks pass

## License

MIT
