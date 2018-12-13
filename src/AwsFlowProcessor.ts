import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { FurnaceConfig, ModuleSpec, SourceType } from "./Model/Config";
import AwsValidator from "./Validation/AwsValidator";
import AwsUtil from "./Util/AwsUtil";

export default class AwsFlowProcessor {
    sourceStreams: Map<string, Object>;

    constructor(private flows: Array<Array<ModuleSpec>>, private config: FurnaceConfig, private environment: string, private buildBucket: string) {
        const errors = AwsValidator.validate(config, flows);
        if (errors.length > 0) throw new Error(JSON.stringify(errors));

        // create the source streams
        this.sourceStreams = new Map<string, aws.kinesis.Stream>();

    }

    async run() {
        for (let source of this.config.sources) {
            let sourceExists = false;
            let name = `${this.config.stack.name}-${source.name}-${this.environment}`;
            
            switch (source.type) {
                case SourceType.AwsKinesisStream:
                    const streamOptions = {
                        name,
                        shardCount: 1
                        // TODO: add more initialisers
                    }  
                    this.sourceStreams.set(name, new aws.kinesis.Stream(name, streamOptions));
                    break;
                default:
                    throw new Error(`unknown source type ${source.type}`);
            }
        }
        
        //if (!this.config.resources || !Array.isArray(this.config.resources)) this.config.resources = [];

        if ( this.config.resources && Array.isArray(this.config.resources) ) {
            for (let resource of this.config.resources) {
                AwsUtil.createResource(resource.name, resource.type, resource.config, this.config.stack.name, this.environment );
            }
        }

        for(let flow of this.flows) {
            if (flow.length === 0) continue;

            const firstStep = flow[0];
            let inputStream = this.sourceStreams.get(firstStep.meta.source!) as aws.kinesis.Stream;
            if (!inputStream) throw new Error(`unable to find input stream ${firstStep.meta.source!}`)

            for (let step of flow) {
                const lambdaName = step.meta.function!;
                const outputStream = step.meta.output!; 

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
                    "STACK_NAME": this.config.stack.name || "unknown"
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
                    runtime: AwsUtil.runtimeFromString("nodejs8.10"), //TODO: get runtime from module spec
                    s3Bucket: this.buildBucket,
                    s3Key: `${step.module}/${step.meta.hash}`,
                    environment: { variables }
                });

                const sourceMapping = new aws.lambda.EventSourceMapping(
                    lambdaName + "-source",
                    {
                        eventSourceArn: inputStream.arn,
                        functionName: lambdaName,
                        enabled: true,
                        batchSize: step.config.aws!.batchSize || this.config.stack.platform.aws!.defaultBatchSize || 1,
                        startingPosition: step.config.aws!.startingPosition || this.config.stack.platform.aws!.defaultStartingPosition || "LATEST",
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