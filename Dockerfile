FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY server/package.json server/pnpm-lock.yaml ./server/
RUN pnpm --dir server install --frozen-lockfile --prod --ignore-scripts
COPY server/*.mjs ./server/
COPY index.html styles.css app.js auth.js config.js service-worker.js manifest.webmanifest favicon.svg ./
COPY assets/pudding-mascot.png ./assets/
RUN mkdir /app/.private && chown node:node /app/.private
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000
EXPOSE 10000
CMD ["node", "server/index.mjs"]

