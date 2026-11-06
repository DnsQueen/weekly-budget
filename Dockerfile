# Draft for Fly.io deploy — NOT deployed yet. Review before running `fly launch`.
# Build stage: TypeScript -> dist/ (same `npm run build` as local).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: the app has zero runtime dependencies (node:sqlite is built in),
# so the image only needs the compiled output and the static frontend.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./
# Run as the non-root `node` user. The volume mounted at /data must be
# writable by that user on first deploy (chown it once), or the server
# cannot create the database file.
USER node
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
