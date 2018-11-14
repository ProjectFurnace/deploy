import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import awsUtil from "./util/awsUtil";

const lambdaName = "Test"

const role = awsUtil.createSimpleIamRole(`${lambdaName}FunctionRole`, "sts:AssumeRole", "lambda.amazonaws.com", "Allow");
const policy = awsUtil.createSimpleIamRolePolicy(`${lambdaName}FunctionPolicy`, role.id, [
    { 
        resource: "arn:aws:logs:*:*:*",
        actions: [ "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents" ]
    }
])

let lambda = new aws.lambda.Function("mylambda", {
    handler: "handler.handler",
    role: role.arn,
    runtime: aws.lambda.NodeJS8d10Runtime,
    s3Bucket: "furnace-artifacts",
    s3Key: "Test"
});