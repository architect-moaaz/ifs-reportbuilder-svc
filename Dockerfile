FROM node:18-alpine
ARG PROFILE

RUN apk add -U --no-cache --allow-untrusted udev ttf-freefont chromium git
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV CHROMIUM_PATH /usr/bin/chromium-browser

WORKDIR  /usr/src/app
COPY  package.json ./
RUN npm install


COPY . .
EXPOSE 31702
ENV NODE_ENV=$PROFILE
RUN echo "$NODE_ENV"
CMD ["node" , "server.js"]
