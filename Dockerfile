FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY tailwind.config.js postcss.config.js ./
COPY index.html ./
COPY public ./public
COPY src ./src

# Build-time env vars (Vite inlines anything prefixed VITE_ at build)
ARG VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_ALCHEMY_API_KEY
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_ALCHEMY_API_KEY=$VITE_ALCHEMY_API_KEY

RUN npm run build

FROM nginx:1.27-alpine AS runtime

# SPA routing + basic security headers
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
