FROM node:24-slim

ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
WORKDIR /app

# Dependensi dulu agar layer ter-cache selama package*.json tidak berubah.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && chown -R node:node /app

COPY --chown=node:node src ./src
# Dokumen awal: hanya diimpor sekali saat penyimpanan masih kosong.
COPY --chown=node:node knowledge ./knowledge
# Folder data (mode file JSON) milik user node agar volume baru bisa ditulis.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/main.js"]
