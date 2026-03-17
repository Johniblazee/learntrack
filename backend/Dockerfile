# ---------- build stage ----------
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build-only system deps (gcc for C extensions)
RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

# Install uv from official image instead of pip install
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Python deps (cached unless pyproject.toml/uv.lock change)
COPY pyproject.toml uv.lock* ./
RUN if [ -f uv.lock ]; then \
      uv sync --no-dev --frozen --no-install-project; \
    else \
      uv sync --no-dev --no-install-project; \
    fi

# ---------- runtime stage ----------
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    PATH="/app/.venv/bin:$PATH"

# Runtime-only system deps (no gcc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user before copying files (avoids chown -R)
RUN useradd -m -s /bin/bash appuser

# Copy venv from builder
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv

# Copy application code
COPY --chown=appuser:appuser . .

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["sh", "-c", "python -c 'from app.core.config import settings' && exec uvicorn app.main:app --workers ${WEB_CONCURRENCY:-1} --host 0.0.0.0 --port ${PORT:-8000}"]
