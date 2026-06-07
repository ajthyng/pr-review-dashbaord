FROM node:24-alpine3.23 AS builder
WORKDIR /app

# Copy manifests first for layer caching
COPY package*.json turbo.json ./
COPY packages/ ./packages/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

# Copy source
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build web, copy output into API public dir, then build API
RUN npm run build -w @pr-review/web
RUN cp -r apps/web/dist/. apps/api/public/
RUN npm run build -w @pr-review/api

# Production stage — reinstall only prod deps to keep image small
FROM node:24-alpine3.23 AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json turbo.json ./
COPY packages/ ./packages/
COPY apps/api/package*.json ./apps/api/
RUN npm ci --omit=dev

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/public ./apps/api/public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
