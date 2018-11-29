import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import AwsUtil from "./Util/AwsUtil";
import { FurnaceConfig, ModuleSpec } from "./Model/Config";
import AwsValidator from "./Validation/AwsValidator";

export default class AwsFlowProcessor {

    constructor(private flows: Array<Array<ModuleSpec>>, config: FurnaceConfig, environment: string) {

        const errors = AwsValidator.validate(config, flows);
        if (errors.length > 0) throw new Error(JSON.stringify(errors));
        
        for(let flow of flows) {
            if (flow.length === 0) continue;

            const firstStep = flow[0];
            const streamName = `${firstStep.name}`;
            const kinesisConfig: aws.kinesis.StreamArgs = {
                name: streamName,
                shardCount: firstStep.config.aws && firstStep.config.aws.shards ? firstStep.config.aws.shards : 1,
            }
            let inputStream = new aws.kinesis.Stream(`${firstStep.name}`, kinesisConfig);

            for (let step of flow) {
                const lambdaName = `${step.name}-${environment}`;
                const outputStream = `${lambdaName}-output-stream`;
                const isLastStep = flow.indexOf(step) === flow.length -1;

                if (!step.config.aws) step.config.aws = {};

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
step.meta.hash = "c84c8f53b427414a71029b8132e9c93822d99c31";
                let lambda = new aws.lambda.Function(lambdaName, {
                    name: lambdaName,
                    handler: "handler.handler",
                    role: role.arn,
                    runtime: aws.lambda.NodeJS8d10Runtime,
                    s3Bucket: config.stack.platform.build.bucket,
                    s3Key: `${step.module}/${step.meta.hash}`,
                    environment: {
                        variables: { 
                            "STREAM_NAME": isLastStep ? "": outputStream,
                            "PARTITION_KEY": step.config.aws!.partitionKey || "DEFAULT"
                        }
                    }
                });
                
                const sourceMapping = new aws.lambda.EventSourceMapping(
                    lambdaName + "-source",
                    {
                        eventSourceArn: inputStream.arn,
                        functionName: lambdaName,
                        enabled: true,
                        batchSize: step.config.aws!.batchSize || config.stack.platform.aws!.defaultBatchSize || 1,
                        startingPosition: step.config.aws!.startingPosition || config.stack.platform.aws!.defaultStartingPosition || "LATEST",
                    }
                );

                if (!isLastStep) { // not last step
                    // create kinesis stream
                    const streamName = outputStream;
                    const kinesisConfig: aws.kinesis.StreamArgs = {
                        name: streamName,
                        shardCount: step.config.aws && step.config.aws.shards ? step.config.aws.shards : 1
                    }
                    inputStream = new aws.kinesis.Stream(streamName, kinesisConfig);
                }
            }
        }
    }
}