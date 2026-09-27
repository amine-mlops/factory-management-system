# NEXUS UI — built in live mode (VITE_USE_MOCK=false, /api) and served by nginx, which proxies /api to the API container.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_USE_MOCK=false
ARG VITE_API_URL=/api
ENV VITE_USE_MOCK=$VITE_USE_MOCK VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
