# One image = the whole demo: the backend serves the built website (web/dist) and the API (also under /api) on one port.
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=web /web/dist /app/web/dist
# seed.seed rebuilds the demo database on every start, so a restarted (or woken) instance is always a fresh demo
CMD ["sh", "-c", "python -m seed.seed && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
