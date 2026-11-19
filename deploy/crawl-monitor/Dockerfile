FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
COPY --chown=node:node scripts/crawl-monitor.mjs scripts/crawler-visits.mjs scripts/traffic-io.mjs ./scripts/
USER node
ENV NODE_ENV=production CRAWL_STATE_DIR=/data
CMD ["node", "scripts/crawl-monitor.mjs"]
