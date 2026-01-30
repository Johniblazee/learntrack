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

# Install system dependencies
# - gcc: needed for compiling some Python packages
# - libpq-dev: PostgreSQL client library (in case needed)
# - curl: for health checks
# - libmagic1: required by python-magic for file type detection
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install UV
RUN pip install --no-cache-dir uv

# Copy pyproject.toml and uv.lock (if it exists)
COPY pyproject.toml .
# Copy explicit lockfile if present (optional - keep wildcard to avoid build failures when lock not committed)
COPY uv.lock* .

# Install Python dependencies using UV into the system Python environment so
# `uvicorn` launched from CMD can import installed packages.
# Do not require a lockfile at build time so builds don't fail when uv.lock is not committed.
RUN uv sync --system

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 8000

# Health check to verify the container is running properly
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Command to run the application
# Render provides PORT environment variable, so we use that
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}