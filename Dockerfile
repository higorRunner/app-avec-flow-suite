FROM node:24-alpine
WORKDIR /app
ARG GIT_SHA=rebuild-1
ENV NODE_ENV=production PORT=3000 GIT_SHA=${GIT_SHA}
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/main.mjs"]
