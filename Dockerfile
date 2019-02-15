FROM ubuntu:bionic

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -my \
        curl \
        gnupg \
        git \
        python-pip \
        jq

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash - && \
    apt-get install -y nodejs

RUN curl -L https://get.pulumi.com/ | bash -s -- --version 0.16.14

RUN pip install awscli

ENV PATH=$PATH:/root/.pulumi/bin

WORKDIR /app

ARG NPM_TOKEN  
COPY .npmrc .npmrc 

COPY package*.json ./

RUN npm install

RUN rm -f .npmrc

COPY . .

CMD /app/deploy.sh
