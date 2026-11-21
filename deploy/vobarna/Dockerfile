FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ENV NODE_ENV=production PORT=8787 PUBLICATION_ROOT=/publication PUBLIC_ORIGIN=https://vobarna.com
WORKDIR /app
COPY src/public-routing.mjs src/date-listings.mjs src/vobarna-server.mjs src/smart-search.mjs src/geocode.mjs src/ai-usage.mjs src/private-json.mjs src/search-*.mjs ./src/
COPY static/cinema-search.js static/search-intent.js static/search-dates.js static/location-search.js static/film-search-content.js static/screening-language.js static/language-labels.js static/outing-search.js static/search-catalogue.js static/search-localization.js ./static/
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/vobarna-server.mjs"]
