# 多阶段构建：构建期才有全部 devDependencies，运行时镜像只带 dist + 零依赖静态服务。
# 构建与运行同用 node:22（Vite 8 要求 Node ≥ 20.19）。
# 用法：docker build -t workbench . && docker run -p 8080:3000 workbench
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY scripts/serve-dist.mjs ./scripts/serve-dist.mjs
ENV PORT=3000
EXPOSE 3000
CMD ["node", "scripts/serve-dist.mjs"]
