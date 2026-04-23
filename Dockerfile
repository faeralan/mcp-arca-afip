FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

FROM base AS ingest
COPY tsconfig.json ./
COPY ingest ./ingest
COPY src ./src
CMD ["npm", "run", "ingest:build"]

FROM base AS dev
COPY tsconfig.json ./
COPY src ./src
CMD ["npm", "run", "dev"]
