FROM node:22-alpine

WORKDIR /app

# 零第三方依赖，不需要 npm install
COPY package.json ./
COPY src ./src
COPY run.mjs daemon.mjs ./

ENV TZ=Asia/Shanghai \
    NODE_ENV=production

# 常驻模式：进程内按 NEWS_TIMES 触发
CMD ["node", "daemon.mjs"]
