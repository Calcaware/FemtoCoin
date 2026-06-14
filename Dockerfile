FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM node:24-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
VOLUME ["/app/data", "/app/wallets"]
ENTRYPOINT ["dumb-init", "node", "index.js", "--headless"]
