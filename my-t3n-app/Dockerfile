FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY server.ts ./
COPY lib ./lib
COPY web ./web

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["npm", "run", "serve"]
