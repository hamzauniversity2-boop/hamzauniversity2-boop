FROM node:22-alpine
WORKDIR /app
COPY frontend/chunks /tmp/chunks
RUN cat /tmp/chunks/part*.txt | base64 -d | gzip -d > /app-index.html
RUN mkdir -p /app/frontend/dist && mv /app-index.html /app/frontend/dist/index.html
COPY frontend/runtime_config_v090.json /app/frontend/dist/runtime_config_v090.json
COPY gateway/server.mjs /app/gateway/server.mjs
ENV NODE_ENV=production PORT=8080 FRONTEND_DIR=/app/frontend/dist
EXPOSE 8080
CMD ["node","/app/gateway/server.mjs"]
