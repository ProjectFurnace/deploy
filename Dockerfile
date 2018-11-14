FROM ubuntu:bionic

RUN apt-get update && \
    apt-get install -my \
        curl \
        gnupg

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash - && \
    apt-get install -y nodejs

RUN curl -L https://get.pulumi.com/ | bash -s -- --version 0.16.2

ENV PATH=$PATH:/root/.pulumi/bin

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .


CMD /app/deploy.sh