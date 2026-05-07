FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY dist/ ./dist/

ENV NODE_ENV=production
ENV PORT=8080
ENV TEMPLATES_DIR=/etc/bahmni_config/apps/clinical/print-templates

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:${PORT}/template-service/health || exit 1

CMD ["node", "dist/server.js"]
