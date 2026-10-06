FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

FROM deps AS build
RUN npm run build && npm prune --omit=dev

# Demo-only stand-in for an OTA (tools/mock-ota). Not part of the app image below.
FROM deps AS mock-ota
ENV PORT=4000
EXPOSE 4000
CMD ["npx", "ts-node", "--transpile-only", "tools/mock-ota/server.ts"]

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
