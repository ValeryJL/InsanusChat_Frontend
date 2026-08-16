# Etapa 1: Build de React + TypeScript + Vite + Assets Offline de Monaco (/vs)
FROM node:20-alpine AS builder

WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=2048"

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Etapa 2: Servidor Nginx de Producción con Proxy Inverso (Web / Mobile)
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
