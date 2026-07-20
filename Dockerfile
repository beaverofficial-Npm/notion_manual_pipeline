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
    fonts-noto-core \
    fonts-nanum \
    fontconfig \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 마스터 PPT 본문 폰트(Pretendard) 실물 설치 — 대체 폰트로 그리면 글자 폭이 달라져
# 뱃지 안 숫자가 줄바꿈되며 밀리는 실사용 이슈가 있었다(2026-07-20). OFL 1.1 재배포.
COPY docker/fonts/*.otf /usr/share/fonts/opentype/pretendard/

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
