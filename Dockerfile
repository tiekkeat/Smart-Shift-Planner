FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

FROM deps AS frontend
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM deps AS api-deps
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]

FROM nginx:stable-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /app/dist /usr/share/nginx/html
