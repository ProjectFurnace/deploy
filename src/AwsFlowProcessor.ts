import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import AwsUtil from "./Util/AwsUtil";
import { Module } from "./Model/Config";
import AwsValidator from "./Validation/AwsValidator";

export default class AwsFlowProcessor {

    constructor(private flows: Array<Array<Module>>, environment: string) {

        const errors = AwsValidator.validate(flows);
        if (errors.length > 0) throw new Error(JSON.stringify(errors));
        
        for(let flow of flows) {
            for (let step of flow) {
                const lambdaName = `${step.name}-${environment}`;

                // create kinesis stream
                const kinesisConfig = {
                    shardCount: step.aws.shards ? step.aws!.shards : 1
                }
                const stream = new aws.kinesis.Stream(`${lambdaName}-output-stream`, kinesisConfig);

                const role = AwsUtil.createSimpleIamRole(`${lambdaName}-FunctionRole`, "sts:AssumeRole", "lambda.amazonaws.com", "Allow");
                const policy = AwsUtil.createSimpleIamRolePolicy(`${lambdaName}-FunctionPolicy`, role.id, [
                    { 
                        resource: "arn:aws:logs:*:*:*",
                        actions: [ "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents" ]
                    },
                    { 
                        resource: "arn:aws:kinesis:*:*:*", //TODO: too open, make specific urn
                        actions: ["kinesis:DescribeStream", "kinesis:PutRecord", "kinesis:PutRecords", "kinesis:GetShardIterator", "kinesis:GetRecords" ]
                    }
                ])

                let lambda = new aws.lambda.Function(lambdaName, {
                    name: lambdaName,
                    handler: "handler.handler",
                    role: role.arn,
                    runtime: aws.lambda.NodeJS8d10Runtime,
                    s3Bucket: "furnace-artifacts",
                    s3Key: "Test"
                });
            }
        }
    }
}