# 웹(next start)과 변환 worker(poll-loop)를 한 이미지로 빌드한다.
# PowerPoint→PDF는 Microsoft Graph가 담당하고, PDF→PNG용 Poppler만 포함한다.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    unzip \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PDFTOPPM_BIN=pdftoppm \
    PDFINFO_BIN=pdfinfo \
    PORT=3000

EXPOSE 3000

# 웹 + 변환 worker(폴링)를 한 컨테이너에서 함께 실행한다.
CMD ["sh", "./scripts/start.sh"]
