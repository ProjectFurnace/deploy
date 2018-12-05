#!/bin/bash

# clone the code repo
TMP_DIR="$(node /app/deploy.js)"
# get data from the stack.yaml file
STATE_REPO="$(node /app/readyaml.js $TMP_DIR/stack.yaml state.repo)"
STACK_NAME="$(node /app/readyaml.js $TMP_DIR/stack.yaml name)"
STACK_REGION="$(node /app/readyaml.js $TMP_DIR/stack.yaml platform.aws.region)"

GIT_OWNER="$(echo $GIT_REMOTE | cut -d '/' -f4)"
GIT_REPO="$(echo $GIT_REMOTE | cut -d '/' -f5 | cut -d '.' -f1 )"

echo "Git and Stack info"
echo "STATE REPO: $STATE_REPO"
echo "STACK NAME: $STACK_NAME"
echo "STACK REGION: $STACK_REGION"
echo "GIT OWNER: $GIT_OWNER"
echo "GIT REPO: $GIT_REPO"

STATE_REPO="${STATE_REPO/:\/\//://$GIT_TOKEN@}"

# initial git config
git config --global user.email "hello@projectfurnace.io"

# clone state repo to folder prev-config
echo "Cloning state repo..."
rm -rf /tmp/pulumi-prev-config
git clone $STATE_REPO /tmp/pulumi-prev-config
# login to pulumi locally
echo "Logging into pulumi locally..."
pulumi login --local

# check if we have a previous stack config
if [ ! -f /tmp/pulumi-prev-config/config.checkpoint.json ]; then
    echo "No previous stack found in github. Proceeding to create a new one..."
    echo "Initializing stack $STACK_NAME-$STACK_ENV..."
    if pulumi stack init $STACK_NAME-$STACK_ENV; then
      echo "Setting aws:region to $STACK_REGION"
      pulumi config set --plaintext aws:region $STACK_REGION
    fi
else
  # previous stack config found
  echo "Initializing stack $STACK_NAME-$STACK_ENV to import previous config..."
  if pulumi stack init $STACK_NAME-$STACK_ENV; then
    pulumi config set --plaintext aws:region $STACK_REGION
    echo "Trying to import previous stack config..."
    if pulumi stack import --file /tmp/pulumi-prev-config/config.checkpoint.json; then
      echo "Selecting stack $STACK_NAME-$STACK_ENV..."
      pulumi stack select $STACK_NAME-$STACK_ENV
    fi
  fi
fi

if [ $? -eq 0 ]; then
  # bring stack up
  echo "Bringing up stack. This may take a while..."
  if pulumi up -y; then
    echo "Stack successfully initiated! Saving pulumi checkpoint..."
    # export current stack state
    mkdir -p new-config
    if pulumi stack export --file /tmp/pulumi-prev-config/config.checkpoint.json; then
      # push new state to github
      echo "Checkpoint succesfully saved. Commiting and pushing to github..."
      cd /tmp/pulumi-prev-config
      # delete old origin so we can add the token
      git remote rm origin
      git remote add origin $STATE_REPO
      # commit to github
      git checkout $(git show-ref --verify --quiet refs/heads/$STACK_ENV || echo '-b') $STACK_ENV
      git add .
      git commit -m 'Update stack'
      if git push --set-upstream origin $STACK_ENV; then
        echo "State successfully saved to git. Marking deployment as succesful."
        curl -d '{"state":"success","description":"Deployment finished successfully"}' -H 'Content-Type: application/json' -H "Authorization: Bearer $GIT_TOKEN" -sS "https://api.github.com/repos/$GIT_OWNER/$GIT_REPO/deployments/$DEPLOYMENT_ID/statuses"
      fi
    fi
  else
    echo "Deployment failed"
    curl -d '{"state":"failure","description":"Deployment failed"}' -H 'Content-Type: application/json' -H "Authorization: Bearer $GIT_TOKEN" -sS "https://api.github.com/repos/$GIT_OWNER/$GIT_REPO/deployments/$DEPLOYMENT_ID/statuses"
  fi
fi
