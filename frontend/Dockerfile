# ── Stage 1: Build ───────────────────────────────────────────────────────
# Build the Vite app into a static bundle.
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first — this layer is cached until package*.json changes.
COPY package*.json ./
RUN npm ci --prefer-offline

# Copy source and build.
# VITE_API_URL defaults to empty so the app uses relative URLs (/api/...).
# The nginx proxy config (nginx.conf) then forwards those to the backend.
# Pass a different value as a Docker build arg to override (e.g. for CDN hosting).
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

COPY . .
RUN npm run build

# ── Stage 2: Serve ───────────────────────────────────────────────────────
# Copy only the compiled static files into a minimal nginx image.
# The full Node/npm toolchain (~300 MB) is discarded.
FROM nginx:1.27-alpine AS runtime

# Copy built assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Replace nginx's default site config with ours (SPA routing + API/WS proxy)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
