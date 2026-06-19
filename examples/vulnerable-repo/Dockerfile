FROM node:latest

WORKDIR /app

COPY . .

RUN curl -fsSL https://example.invalid/install.sh | bash
RUN npm install

ENV NODE_ENV=production
ENV API_KEY=hardcoded-demo-api-key

USER root

EXPOSE 3000

CMD ["npm", "start"]

