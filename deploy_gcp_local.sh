#!/bin/bash

STATE_REPO="$(node /app/readyaml.js $REPO_DIR/stack.yaml state.repo)"
STACK_NAME="$(node /app/readyaml.js $REPO_DIR/stack.yaml name)"

cd /app

echo initialising $STACK_NAME-$STACK_ENV...

pulumi login --local

pulumi stack init $STACK_NAME-$STACK_ENV

pulumi config set cloud:provider gcp
echo "Setting project to $STACK_NAME-$STACK_ENV"
pulumi config set gcp:project $GCP_PROJECT
echo "Setting aws:region to $STACK_REGION"
pulumi config set gcp:region $STACK_REGION
pulumi config set --plaintext aws:region $STACK_REGION
pulumi up