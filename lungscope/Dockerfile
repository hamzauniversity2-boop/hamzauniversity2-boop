FROM node:22-alpine
WORKDIR /app
COPY frontend/index.html.gz.b64 /tmp/index.html.gz.b64
RUN mkdir -p /app/frontend/dist && base64 -d /tmp/index.html.gz.b64 | gzip -d > /app/frontend/dist/index.html
COPY frontend/runtime_config_v090.json /app/frontend/dist/runtime_config_v090.json
COPY gateway/server.mjs /app/gateway/server.mjs
ENV NODE_ENV=production PORT=8080 FRONTEND_DIR=/app/frontend/dist
EXPOSE 8080
CMD ["node","/app/gateway/server.mjs"]
