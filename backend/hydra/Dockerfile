# hydra backend — AUTHORIZED TESTING ONLY. Node wrapper around THC-Hydra.
FROM node:20-alpine
RUN apk add --no-cache hydra
WORKDIR /app
COPY server.cjs ./
CMD ["node", "server.cjs"]
