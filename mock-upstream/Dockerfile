# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app

# Dependency-free on purpose: the stand-in provider should never be the reason a load
# test fails to start.
COPY server.js ./

USER node
EXPOSE 8081

CMD ["node", "server.js"]
