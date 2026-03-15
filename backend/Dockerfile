# Use Python 3.11 as the base image
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Set environment variables
# Prevents Python from writing .pyc files
ENV PYTHONDONTWRITEBYTECODE=1
# Prevents Python from buffering stdout/stderr
ENV PYTHONUNBUFFERED=1
# Set the environment to production
ENV ENVIRONMENT=production
# Make the uv-managed virtualenv available to later build steps and the final CMD.
ENV PATH="/app/.venv/bin:$PATH"

# Install system dependencies
# - gcc: needed for compiling some Python packages
# - curl: for health checks
# - libmagic1: required by python-magic for file type detection
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash appuser

# Install UV
RUN pip install --no-cache-dir uv

# Copy pyproject.toml and uv.lock (if it exists)
COPY pyproject.toml .
# Copy explicit lockfile if present (optional - keep wildcard to avoid build failures when lock not committed)
COPY uv.lock* .

# Install Python dependencies into uv's project virtualenv. We skip installing the
# project package here because the application source is copied in the next layer
# and `uvicorn app.main:app` imports directly from /app.
# Do not require a lockfile at build time so builds don't fail when uv.lock is not committed.
RUN if [ -f uv.lock ]; then uv sync --no-dev --frozen --no-install-project; else uv sync --no-dev --no-install-project; fi

# Copy the rest of the application code
COPY . .

# Give non-root user ownership and switch to it
RUN chown -R appuser:appuser /app
USER appuser

# Expose the port the app runs on
EXPOSE 8000

# Health check to verify the container is running properly
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Command to run the application.
# Validate config once before spawning workers so misconfigured secrets fail fast
# with a single clear error instead of timing out after repeated worker crashes.
# Render provides PORT; default worker count is kept low for small instances.
CMD ["sh", "-c", "python -c 'from app.core.config import settings' && exec uvicorn app.main:app --workers ${WEB_CONCURRENCY:-1} --host 0.0.0.0 --port ${PORT:-8000}"]
