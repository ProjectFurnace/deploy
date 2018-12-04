import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import AwsUtil from "./Util/AwsUtil";
import { FurnaceConfig, ModuleSpec, SourceType } from "./Model/Config";
import AwsValidator from "./Validation/AwsValidator";
import awsUtil from "./Util/AwsUtil";

export default class AwsFlowProcessor {

    constructor(private flows: Array<Array<ModuleSpec>>, config: FurnaceConfig, environment: string, buildBucket: string) {

        const errors = AwsValidator.validate(config, flows);
        if (errors.length > 0) throw new Error(JSON.stringify(errors));
        
        // create the source streams
        let sourceStreams = new Map<string, aws.kinesis.Stream>();

        for (let source of config.sources) {
            const name = source.name + (source.perEnvironment ? `-${environment}` : "");
            switch (source.type) {
                case SourceType.AwsKinesisStream:
                    sourceStreams.set(name, new aws.kinesis.Stream(name, {
                        name,
                        shardCount: 1
                        // TODO: add more initialisers
                    }))
                    break;
                default:
                    throw new Error(`unknown source type ${source.type}`);
            }
        }

        for (let resource of config.resources) {
            AwsUtil.createResource(resource.name, resource.type, resource.config);
        }

        for(let flow of flows) {
            if (flow.length === 0) continue;

            const firstStep = flow[0];
            let inputStream = sourceStreams.get(firstStep.meta.source!) as aws.kinesis.Stream;

            for (let step of flow) {
                const lambdaName = step.meta.function!; //`${step.name}-${environment}`;
                const outputStream = step.meta.output!; //`${lambdaName}-output-stream`;

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

                const variables: { [key: string]: string } = {
                    "STACK_NAME": config.stack.name || "unknown"
                };

                for (let param of step.parameters) {
                    variables[param[0].toUpperCase().replace("'", "").replace("-", "_")] = param[1];
                }

                if (!isLastStep) {
                    variables["STREAM_NAME"] = outputStream;
                    variables["PARTITION_KEY"] = step.config.aws!.partitionKey || "DEFAULT";
                }

                const lambda = new aws.lambda.Function(lambdaName, {
                    name: lambdaName,
                    handler: "handler.handler",
                    role: role.arn,
                    runtime: awsUtil.runtimeFromString("nodejs8.10"), //TODO: get runtime from module spec
                    s3Bucket: buildBucket,
                    s3Key: `${step.module}/${step.meta.hash}`,
                    environment: { variables }
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

                if (!isLastStep) {
                    // create kinesis stream
                    const kinesisConfig: aws.kinesis.StreamArgs = {
                        name: outputStream,
                        shardCount: step.config.aws && step.config.aws.shards ? step.config.aws.shards : 1
                    }
                    inputStream = new aws.kinesis.Stream(outputStream, kinesisConfig);
                }
            }
        }
    }
}