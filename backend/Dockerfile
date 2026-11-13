FROM node:22.22.3-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

USER node

EXPOSE 3000

CMD ["npx", "tsx", "src/index.ts"]
