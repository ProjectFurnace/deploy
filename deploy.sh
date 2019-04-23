#!/bin/bash

# ARM_SUBSCRIPTION_ID=$(curl -s -H Metadata:true "http://169.254.169.254/metadata/instance?api-version=2018-10-01" |jq -r .subscriptionId)

ARM_SUBSCRIPTION_ID=$(az login --identity |jq .[0].id)

GIT_TOKEN="$(az keyvault secret show --vault-name $FURNACE_INSTANCE-vault --name GitToken |jq -r .value)"
# GIT_TOKEN="$(az keyvault secret show --vault-name $FURNACE_INSTANCE-vault --name NpmToken |jq -r .value)"

if [ -n "$GIT_TOKEN" ]; then
  echo "Setting GIT token env var..."
  export GIT_TOKEN="$GIT_TOKEN"
fi

# if [ -n "$NPM_TOKEN" ]; then
#   echo "Setting NPM token env var..."
#   export NPM_TOKEN="$NPM_TOKEN"
# fi

# clone the code repo
TMP_DIR="$(node /app/deploy.js)"
# get data from the stack.yaml file
STATE_REPO="$(node /app/readyaml.js $TMP_DIR/stack.yaml state.repo)"
STACK_NAME="$(node /app/readyaml.js $TMP_DIR/stack.yaml name)"

GIT_OWNER="$(echo $GIT_REMOTE | cut -d '/' -f4)"
GIT_REPO="$(echo $GIT_REMOTE | cut -d '/' -f5 | cut -d '.' -f1 )"

if [ -z "$STATE_REPO" ] || [ -z "$STACK_NAME" ]  || [ -z "$GIT_OWNER" ] || [ -z "$GIT_REPO" ]; then
  echo "Some essential variables are missing. Exiting..."
  exit 1
fi

echo "Git and Stack info"
echo "STATE REPO: $STATE_REPO"
echo "STACK NAME: $STACK_NAME"
echo "GIT OWNER: $GIT_OWNER"
echo "GIT REPO: $GIT_REPO"

# set status as pending for deployment
curl -o /dev/null -d '{"state":"in_progress","description":"Deployment started..."}' -H 'Content-Type: application/json' -H 'Accept: application/vnd.github.flash-preview+json' -H "Authorization: Bearer $GIT_TOKEN" -sS "https://api.github.com/repos/$GIT_OWNER/$GIT_REPO/deployments/$DEPLOYMENT_ID/statuses"

STATE_REPO="${STATE_REPO/:\/\//://$GIT_TOKEN@}"

# initial git config
git config --global user.email "hello@furnace.org"

PREV_PWD="$(pwd)"

# clone state repo to folder prev-config
echo "Cloning state repo..."
rm -rf /tmp/pulumi-prev-config
if git clone $STATE_REPO /tmp/pulumi-prev-config; then
  # checkout branch and act depending on if it exists or not
  if git -C /tmp/pulumi-prev-config show-ref --verify --quiet refs/heads/$STACK_ENV; then
    git -C /tmp/pulumi-prev-config  checkout $STACK_ENV
  else
    git -C /tmp/pulumi-prev-config checkout -b $STACK_ENV
    # make sure the folder is empty (for when we promote)
    rm -rf /tmp/pulumi-prev-config/*
  fi
else
  echo "State repo does not exist. Exiting..."
  exit 1
fi

# create output log folder if it does not exist
if [ ! -d /tmp/pulumi-prev-config/commit ]; then
  mkdir -p /tmp/pulumi-prev-config/commit;
fi

# login to pulumi locally
echo "Logging into pulumi locally..."
pulumi login --local

echo "Initializing stack $STACK_NAME-$STACK_ENV..."
if pulumi stack init $STACK_NAME-$STACK_ENV; then
  # check if we have a previous stack config
  if [ -f /tmp/pulumi-prev-config/config.checkpoint.json ]; then
    echo "Found previous stack state. Trying to import it..."
    if pulumi stack import --file /tmp/pulumi-prev-config/config.checkpoint.json; then
      echo "Selecting stack $STACK_NAME-$STACK_ENV..."
      pulumi stack select $STACK_NAME-$STACK_ENV
    fi
  fi
fi

if [ $? -eq 0 ]; then
  # bring stack up
  echo "Bringing up stack. This may take a while..."
  pulumi up -y |& tee /tmp/pulumi-prev-config/commit/$GIT_TAG.log
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "Deplyoment succesful. Updating status in github..."
    curl -o /dev/null -d '{"state":"success","description":"Deployment finished successfully"}' -H 'Content-Type: application/json' -H "Authorization: Bearer $GIT_TOKEN" -sS "https://api.github.com/repos/$GIT_OWNER/$GIT_REPO/deployments/$DEPLOYMENT_ID/statuses"
  else
    echo "Deployment failed.  Updating status in github..."
    curl -o /dev/null -d '{"state":"failure","description":"Deployment failed"}' -H 'Content-Type: application/json' -H "Authorization: Bearer $GIT_TOKEN" -sS "https://api.github.com/repos/$GIT_OWNER/$GIT_REPO/deployments/$DEPLOYMENT_ID/statuses"
  fi

  echo "Proceeding to save pulumi checkpoint..."
  # export current stack state
  if pulumi stack export --file /tmp/pulumi-prev-config/config.checkpoint.json; then
    # push new state to github
    echo "Checkpoint succesfully saved..."
  else
    echo "Checkpoint saving failed..."
  fi

  cd /tmp/pulumi-prev-config
  # delete old origin so we can add the token
  git remote rm origin
  git remote add origin $STATE_REPO
  # commit to github
  git add .
  git commit -m 'Update stack'
  if git push --set-upstream origin $STACK_ENV; then
    echo "State successfully saved to git."
  fi
fi
