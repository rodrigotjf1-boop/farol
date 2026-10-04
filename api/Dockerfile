# =====================================================================
# Farol · imagem do farol-api
# =====================================================================
# ATENÇÃO: o contexto de build é a RAIZ do repositório, não api/.
# Precisa ser, porque a imagem leva também database/migrations — é esse
# COPY que faz as migrations chegarem ao contêiner pelo deploy em vez de
# pelo Ctrl+V num terminal.
#
# No EasyPanel: Dockerfile = api/Dockerfile, contexto = . (raiz)
# =====================================================================

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY api/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# O runner e as migrations viajam juntos com a aplicação. `npm run migrar`
# roda daqui de dentro, contra o DATABASE_URL do ambiente do serviço —
# sem expor porta de banco e sem segredo saindo do painel.
COPY api/scripts ./scripts
COPY database ./database

# Não roda como root. O usuário 'node' (uid 1000) já vem na imagem oficial.
USER node
EXPOSE 3000
CMD ["node", "dist/servidor.js"]
