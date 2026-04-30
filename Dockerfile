# Use the official Playwright image which bundles a tested Chromium binary.
# This avoids separately installing Chromium and dealing with dependency issues.
FROM mcr.microsoft.com/playwright:v1.54.0-noble

WORKDIR /app

# Copy package files first for Docker layer caching.
# If package.json hasn't changed, npm ci uses the cached layer.
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled TypeScript output
COPY dist/ ./dist/

# Set runtime environment variables.
# CHROMIUM_PATH must match the Chromium binary in the Playwright image.
ENV NODE_ENV=production
ENV PORT=8080
ENV CHROMIUM_PATH=/ms-playwright/chromium-1181/chrome-linux/chrome
ENV TEMPLATES_DIR=/etc/bahmni_config/apps/clinical/print-templates

EXPOSE 8080

# Health check used by Docker Compose and orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8080/template-service/health || exit 1

CMD ["node", "dist/server.js"]
