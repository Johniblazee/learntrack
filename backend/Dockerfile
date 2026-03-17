FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    PATH="/app/.venv/bin:$PATH"

# uv from official image (no pip install needed)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Runtime system deps only
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash appuser

# Install Python deps (cached layer unless pyproject.toml/uv.lock change)
COPY --chown=appuser:appuser pyproject.toml uv.lock* ./
RUN if [ -f uv.lock ]; then \
      uv sync --no-dev --frozen --no-install-project; \
    else \
      uv sync --no-dev --no-install-project; \
    fi

# Copy application code
COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["sh", "-c", "python -c 'from app.core.config import settings' && exec uvicorn app.main:app --workers ${WEB_CONCURRENCY:-1} --host 0.0.0.0 --port ${PORT:-8000}"]
