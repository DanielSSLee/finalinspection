# Production Dockerfile for US Modules FVI Station Console
FROM python:3.11-slim

WORKDIR /app

# Prevent python from buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application static files, templates, scripts
COPY . /app/

# Create EL cache directory
RUN mkdir -p /app/el_cache

# Expose HTTP Edge Gateway Port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/status || exit 1

# Launch Edge Gateway Server
CMD ["python", "server.py"]
