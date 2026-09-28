FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Cloud Run sets PORT; 8080 is the default it expects.
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "src/server.js"]
