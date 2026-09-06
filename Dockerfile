FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY workers ./workers
COPY chains ./chains
COPY shared ./shared
COPY infra ./infra

RUN npm run build || true

EXPOSE 8787

CMD ["npx", "wrangler", "dev", "workers/capital-machine/index.ts", "--host", "0.0.0.0"]
