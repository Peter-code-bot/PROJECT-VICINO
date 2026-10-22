FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node api.mjs transcode.mjs worker.mjs ./
USER node
ENV NODE_ENV=production
CMD ["node", "worker.mjs"]
