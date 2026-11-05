FROM node:22-alpine AS base

# Install libc6-compat for Next.js swc on alpine
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@10

WORKDIR /app

# Install dependencies using pinned pnpm 10
COPY .npmrc* package.json pnpm-lock.yaml* ./
RUN pnpm install

# Copy source and build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "pnpm run db:setup && pnpm start"]
