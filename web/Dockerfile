# =====================================================================
# Farol · imagem do farol-web (console)
# =====================================================================
# Contexto de build: a RAIZ do repositório (igual ao farol-api), para os
# dois serviços terem a mesma configuração no painel e ninguém errar.
#
# No EasyPanel: Dockerfile = web/Dockerfile, Build Path = .
# =====================================================================

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
# A URL da API entra no build? NÃO. Ela é lida em tempo de execução pelo
# `next.config.mjs`, porque o proxy roda no servidor. Assar endereço na
# imagem obrigaria a reconstruir para trocar de ambiente.
RUN npm run build

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# `output: standalone` monta uma pasta com só o que o servidor precisa —
# nada de node_modules inteiro na imagem final.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Não roda como root.
USER node
EXPOSE 3000
CMD ["node", "server.js"]
