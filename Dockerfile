# 웹(next start)과 변환 worker(poll-loop)를 한 이미지로 빌드한다.
# 변환에 필요한 LibreOffice/Poppler/한글폰트를 포함한다.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    poppler-utils \
    unzip \
    zip \
    fonts-noto-cjk \
    fonts-noto-cjk-extra \
    fonts-nanum \
    fontconfig \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Windows 한글 폰트(맑은 고딕 등) → 설치 폰트 매핑. 대체 폰트를 예측 가능하게 해 텍스트 넘침/겹침을 줄인다.
COPY docker/fonts-local.conf /etc/fonts/conf.d/99-korean-aliases.conf
RUN fc-cache -f

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    SOFFICE_BIN=soffice \
    PDFTOPPM_BIN=pdftoppm \
    PORT=3000

EXPOSE 3000

# 웹 + 변환 worker(폴링)를 한 컨테이너에서 함께 실행한다.
CMD ["sh", "./scripts/start.sh"]
