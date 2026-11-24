# The app image. Needs output: 'standalone' in next.config.js, so that
# `npm run build` writes .next/standalone (server.js and the node_modules it uses).
# Keys are not baked in: docker/app-entrypoint.sh reads /keys/supabase.env at start.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node docker/app-entrypoint.sh /app/app-entrypoint.sh
# The owner's saved setup answers; docker-compose.yml mounts the settings volume here.
RUN mkdir -p /app/.cosign && chown node:node /app/.cosign
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/app/app-entrypoint.sh"]
