FROM ghcr.io/puppeteer/puppeteer:latest

# Define o diretório de trabalho usando o usuário padrão da imagem (pptruser)
WORKDIR /home/pptruser/app

# Copia os arquivos de configuração do Node
COPY package*.json ./

# Instala as dependências ignorando o download do Chromium (a imagem já tem o Chrome embutido)
RUN npm install

# Copia o resto do código da API
COPY . .

# Expõe a porta que o Render vai usar
EXPOSE 3000

# Inicia o servidor
CMD ["node", "sponte_api.js"]
