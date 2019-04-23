FROM ubuntu:bionic

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -my \
        curl \
        wget \
        gnupg \
        git \
        python-pip \
        jq \
        apt-transport-https \
        lsb-release \
        gpg

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash - && \
    apt-get install -y nodejs

RUN curl -L https://get.pulumi.com/ | bash -s -- --version 0.17.5

RUN curl -sL https://packages.microsoft.com/keys/microsoft.asc | \
    gpg --dearmor | \
    tee /etc/apt/trusted.gpg.d/microsoft.asc.gpg > /dev/null

RUN AZ_REPO=$(lsb_release -cs) && \
    echo "deb [arch=amd64] https://packages.microsoft.com/repos/azure-cli/ $AZ_REPO main" | \
    tee /etc/apt/sources.list.d/azure-cli.list

RUN wget -q https://packages.microsoft.com/config/ubuntu/18.10/packages-microsoft-prod.deb && \
    dpkg -i packages-microsoft-prod.deb

RUN curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg && \
    mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg

RUN sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-$(lsb_release -cs)-prod $(lsb_release -cs) main" > /etc/apt/sources.list.d/dotnetdev.list'

RUN apt-get update && apt-get install -y azure-cli dotnet-sdk-2.2 azure-functions-core-tools

RUN pip install awscli

ENV PATH=$PATH:/root/.pulumi/bin

WORKDIR /app

ARG NPM_TOKEN  
#COPY .npmrc .npmrc 

COPY package*.json ./

RUN npm install

#RUN rm -f .npmrc

COPY . .

CMD /app/deploy.sh
