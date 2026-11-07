# dns backend — dependency-free Node service
FROM node:20-alpine
WORKDIR /app
COPY server.cjs ./
USER node
CMD ["node", "server.cjs"]
