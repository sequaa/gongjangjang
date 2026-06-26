# Synthetic sensor simulator (PIPE-01).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
CMD ["npx", "tsx", "src/index.ts"]
