# nmap backend — Node wrapper around the real nmap binary
FROM node:20-alpine
RUN apk add --no-cache nmap nmap-scripts
WORKDIR /app
COPY server.cjs ./
CMD ["node", "server.cjs"]
