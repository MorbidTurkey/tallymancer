FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (Docker layer caching: this layer only
# rebuilds when requirements.txt changes, not on every code change).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code.
COPY . .

# Expose the port uvicorn will listen on.
EXPOSE 8000

# Run the API.  uvicorn binds to 0.0.0.0 so Docker's port mapping works.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
