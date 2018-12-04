#!/bin/bash

pulumi stack select ${STACK_NAME}
pulumi up -y