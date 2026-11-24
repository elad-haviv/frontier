# Build: install everything, compile the packages, the server and the web app.
FROM node:22-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

# Run: Node, Git, pandoc (for Word and PDF exports; Trixie's writes Typst), the compiled code
# and its production dependencies.
FROM node:22-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl pandoc \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1
CMD ["node", "apps/server/dist/main.js"]
