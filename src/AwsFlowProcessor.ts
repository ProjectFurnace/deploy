import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { FurnaceConfig, FlowSpec, SourceType } from "./Model/Config";
import AwsValidator from "./Validation/AwsValidator";
import AwsUtil from "./Util/AwsUtil";

export default class AwsFlowProcessor {
    sourceStreamArns: Map<string, pulumi.Output<string>>;

    constructor(private flows: Array<Array<FlowSpec>>, private config: FurnaceConfig, private environment: string, private buildBucket: string) {
        const errors = AwsValidator.validate(config, flows);
        if (errors.length > 0) throw new Error(JSON.stringify(errors));

        // create the source streams
        this.sourceStreamArns = new Map<string, pulumi.Output<string>>();
    }

    async run() {
        for (let source of this.config.sources) {
            let sourceExists = false;
            let name = `${this.config.stack.name}-${source.name}-${this.environment}`;
            
            const awsConfig = ( source.config && source.config.aws ? source.config.aws : {} );

            switch (source.type) {
                case SourceType.AwsKinesisStream:
                    const streamOptions = {
                        name,
                        ...awsConfig
                    }
                    // set any required parameters if unset
                    if (!streamOptions.shardCount) streamOptions.shardCount = 1;
                    
                    const sourceStream = new aws.kinesis.Stream(name, streamOptions);

                    this.sourceStreamArns.set(name, sourceStream.arn);
                    break;
                default:
                    throw new Error(`unknown source type ${source.type}`);
            }
        }

        let createdResources = new Map<string, any>();

        if (this.config.resources && Array.isArray(this.config.resources) ) {
            for (let resource of this.config.resources) {
                let resourceName = `${this.config.stack.name}-${resource.name}-${this.environment}`;

                const createdResource = await AwsUtil.createResource(resourceName, resource.type, resource.config, this.config.stack.name, this.environment);
                createdResources.set(resource.name, createdResource);
            }
        }

        const iden = await aws.getCallerIdentity();

        for(let flow of this.flows) {
            if (flow.length === 0) continue;

            const firstStep = flow[0];
            let inputStreamArn = this.sourceStreamArns.get(firstStep.meta.source!);
            if (!inputStreamArn) throw new Error(`unable to find input stream ${firstStep.meta.source!}`)

            for (let step of flow) {

                const resourceName = step.meta.identifier!
                    , outputStreamName = step.meta.output!
                    , isSink = step.component === "sink"
                    ;

                if (!step.config) step.config = {};
                if (!step.config.aws) step.config.aws = {};

                if (step.type === "Module") {
                    const role = AwsUtil.createSimpleIamRole(`${resourceName}-role`, "sts:AssumeRole", "lambda.amazonaws.com", "Allow");
                    
                    const policy = AwsUtil.createSimpleIamRolePolicy(`${resourceName}-policy`, role.id, [
                        { 
                            resource: `arn:aws:logs:${aws.config.region}:${iden.accountId}:*`,
                            actions: [ "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents" ]
                        },
                        { 
                            resource: [`arn:aws:kinesis:${aws.config.region}:${iden.accountId}:stream/${step.meta.source}`, `arn:aws:kinesis:${aws.config.region}:${iden.accountId}:stream/${step.meta.output}`],
                            actions: ["kinesis:DescribeStream", "kinesis:PutRecord", "kinesis:PutRecords", "kinesis:GetShardIterator", "kinesis:GetRecords", "kinesis:ListStreams"]
                        }
                    ])

                    if (step.policies) {
                        for (let p of step.policies) {
                            new aws.iam.RolePolicyAttachment(`${resourceName}-${p}`, {
                                role,
                                policyArn: `arn:aws:iam::aws:policy/${p}`
                            })
                        }
                    }

                    const variables: { [key: string]: string } = {
                        "STACK_NAME": this.config.stack.name || "unknown",
                        "STACK_ENV": this.environment || "unknown"
                    };

                    for (let param of step.parameters) {
                        variables[param[0].toUpperCase().replace("'", "").replace("-", "_")] = param[1];
                    }

                    if (!isSink) {
                        variables["STREAM_NAME"] = outputStreamName;
                        variables["PARTITION_KEY"] = step.config.aws!.partitionKey || "DEFAULT";
                    }

                    if (step.logging === "debug") variables["DEBUG"] = "1";

                    const lambda = new aws.lambda.Function(resourceName, {
                        name: resourceName,
                        handler: "handler.handler",
                        role: role.arn,
                        runtime: AwsUtil.runtimeFromString(step.runtime ? step.runtime : 'nodejs8.10'),
                        s3Bucket: this.buildBucket,
                        s3Key: `${step.module}/${step.meta.hash}`,
                        environment: { variables }
                    });

                    const sourceMapping = new aws.lambda.EventSourceMapping(
                        resourceName + "-source",
                        {
                            eventSourceArn: inputStreamArn,
                            functionName: resourceName,
                            enabled: true,
                            batchSize: step.config.aws!.batchSize || this.config.stack.platform.aws!.defaultBatchSize || 1,
                            startingPosition: step.config.aws!.startingPosition || this.config.stack.platform.aws!.defaultStartingPosition || "LATEST",
                        }
                    );
                } else {

                    let createdResource: pulumi.Output<string> | undefined;
                    if (step.resource) {
                        const resource = this.config.resources.find(res => res.name === step.resource);
                        if (!resource) throw new Error(`unable to find resource ${step.resource} specified in ${step.name}`);

                        createdResource = createdResources.get(resource.name);

                        if (!createdResource) throw new Error(`unable to get active resource ${resource.name}`);
                    }

                    if (step.type === "AwsFirehose") {
                        AwsUtil.createFirehose(resourceName, createdResource, step.config.aws, inputStreamArn);
                    } else {
                        throw new Error(`unknown step type '${step.type}'`);
                    }
                }

                if (!isSink) {
                    let outputType = this.config.stack.platform.aws!.defaultRoutingMechanism || "KinesisStream";

                    const routingResourceArn = AwsUtil.createRoutingResource(outputStreamName, outputType, step.config);
                    inputStreamArn = routingResourceArn;
                }
            }
        }
    }
}