FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci
COPY src ./src
COPY index.html ./
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
RUN npm install -g http-server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/index.html ./
EXPOSE 8080
CMD ["http-server", ".", "-p", "8080", "-c-1"]

FROM node:20-alpine AS development
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY generate-config.sh ./
RUN chmod +x generate-config.sh
RUN npm install
EXPOSE 8080
CMD ["sh", "-c", "./generate-config.sh && npx copyfiles -u 1 src/styles.css dist && npm run watch & npx http-server . -p 8080 -c-1"]
