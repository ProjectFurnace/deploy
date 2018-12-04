#!/bin/bash

# clone state repo to folder prev-config
git clone $STATE_REPO prev-config
# login to pulumi locally
pulumi login --local
# select the appropiate stack
pulumi stack select $STACK_NAME
# import previous stack config
pulumi stack import --file prev-config/config.checkpoint.json
# bring stack up
pulumi up -y
# export current stack state
pulumi stack export --file new-config/config.checkpoint.json
# push new state to github
( cd new-config; git commit -m 'Update stack')
( cd new-config; git push)
