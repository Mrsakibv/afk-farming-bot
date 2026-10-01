FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY bot.js ./bot.js

ENV NODE_ENV=production
ENV BROWSER_PROFILE=/data/browser-profile
ENV STORAGE_STATE_FILE=/data/storage-state.json

RUN mkdir -p /data/browser-profile

CMD ["npm", "start"]
