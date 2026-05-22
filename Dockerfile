FROM node:18-slim

# Instala as dependências necessárias para o Google Chrome rodar no Linux
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Cria e define o diretório de trabalho
WORKDIR /app

# Copia os arquivos do pacote
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o código da API
COPY . .

# A porta que o Render vai usar
EXPOSE 3000

# Inicia o servidor
CMD ["node", "sponte_api.js"]
