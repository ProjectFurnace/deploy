import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import AwsValidator from "./Validation/AwsValidator";
import AwsUtil from "./Util/AwsUtil";
import IFlowProcessor from "./IFlowProcessor";
import { Source, BuildSpec, SourceType, FurnaceConfig, Stack } from "@project-furnace/stack-processor/src/Model";

export default class AwsFlowProcessor implements IFlowProcessor {
  // sourceStreamArns: Map<string, pulumi.Output<string>>;

  constructor(private flows: Array<BuildSpec>, private stackConfig: Stack, private environment: string, private buildBucket: string) {
    // const errors = AwsValidator.validate(config, flows);
    // if (errors.length > 0) throw new Error(JSON.stringify(errors));

    // this.sourceStreamArns = new Map<string, pulumi.Output<string>>();
  }

  async process(): Promise<Array<pulumi.CustomResource>> {
    const identity = await aws.getCallerIdentity();

    const sources = this.flows.filter(flow => flow.component === "source")
      , resources = this.flows.filter(flow => flow.component === "resource")
      ;

    const sourceResources = this.flows
      .filter(flow => flow.component === "source")
      .map(flow => this.createSourceComponent(flow as Source));

    const routingResources = this.flows
      .filter(flow => flow.meta)
      .map(flow => this.createRoutingComponent(flow));

    const resourceResources = this.flows
      .filter(flow => flow.component === "resource")
      .map(flow => this.createResourceComponent(flow));

    // const moduleResources = this.flows
    //   .filter(flow => flow.type === "Module")
    //   .map(flow => {

    //     return this.createModuleResource(flow, routingResources.find(o => o) ,identity.accountId);
    //   });    

    return [ 
      ...sourceResources,
      ...routingResources,
      ...resourceResources
    ]

  }

  // getEventSourceArn(name: string, sources: Array<pulumi.CustomResource>): pulumi.Output<string> {
    
  //   // const source = sources.find(o => o.)
  //   // return this.flows[0];
  // }

  createModuleResource(component: BuildSpec, routingResource: pulumi.Resource, accountId: string): Array<pulumi.CustomResource> {

    const stackName = this.stackConfig.name;
    const { identifier } = component.meta!;

    const resources: Array<pulumi.CustomResource> = [];
    
    const defaultBatchSize = this.stackConfig.platform.aws!.defaultBatchSize || 1
        , defaultStartingPosition = this.stackConfig.platform.aws!.defaultStartingPosition || "LATEST"
        ;

    const role = AwsUtil.createSimpleIamRole(`${identifier}-role`, "sts:AssumeRole", "lambda.amazonaws.com", "Allow");
    resources.push(role);

    resources.push(AwsUtil.createSimpleIamRolePolicy(`${identifier}-policy`, role.id, [
      {
        resource: `arn:aws:logs:${aws.config.region}:${accountId}:*`,
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      },
      {
        resource: [`arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${component.meta!.source}`, `arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${component.meta!.output}`],
        actions: ["kinesis:DescribeStream", "kinesis:PutRecord", "kinesis:PutRecords", "kinesis:GetShardIterator", "kinesis:GetRecords", "kinesis:ListStreams"]
      },
      {
        resource: [`arn:aws:ssm:${aws.config.region}:${accountId}:parameter/${process.env.FURNACE_INSTANCE}/${identifier}/*`],
        actions: ["ssm:GetParametersByPath"]
      }
    ]));

    if (component.policies) {
      for (let p of component.policies) {
        new aws.iam.RolePolicyAttachment(`${identifier}-${p}`, {
          role,
          policyArn: `arn:aws:iam::aws:policy/${p}`
        })
      }
    }

    const variables: { [key: string]: string } = {
      "STACK_NAME": stackName || "unknown",
      "STACK_ENV": this.environment || "unknown",
      "FURNACE_INSTANCE": process.env.FURNACE_INSTANCE || "unknown"
    };

    for (let param of component.parameters) {
      variables[param[0].toUpperCase().replace("'", "").replace("-", "_")] = param[1];
    }

    if (component.component !== "sink") {
      variables["STREAM_NAME"] = component.meta!.output;
      variables["PARTITION_KEY"] = component.config.aws!.partitionKey || "DEFAULT";
    }

    if (component.logging === "debug") variables["DEBUG"] = "1";

    resources.push(new aws.lambda.Function(identifier, {
      name: identifier,
      handler: "handler.handler",
      role: role.arn,
      runtime: AwsUtil.runtimeFromString(component.moduleSpec.runtime ? component.moduleSpec.runtime : 'nodejs8.10'),
      s3Bucket: this.buildBucket,
      s3Key: `${component.module}/${component.buildSpec!.hash}`,
      environment: { variables }
    }));

    // resources.push(new aws.lambda.EventSourceMapping(
    //   identifier + "-source",
    //   {
    //     eventSourceArn: inputStreamArn,
    //     functionName: identifier,
    //     enabled: true,
    //     batchSize: component.config.aws!.batchSize || defaultBatchSize,
    //     startingPosition: component.config.aws!.startingPosition || defaultStartingPosition,
    //   }
    // ));

    // this.processIOParameters(flow, lambda, createdResources);
    return resources;
  }

  createResourceComponent(component: BuildSpec): pulumi.CustomResource {

    const { name, type, config } = component;
    const stackName = this.stackConfig.name;

    switch (type) {
      case 'elasticsearch.Domain':
        config.domainName = name;
        return new aws.elasticsearch.Domain(name, config as aws.elasticsearch.DomainArgs);

      case 'redshift.Cluster':
        config.clusterIdentifier = name;

        const secretName = `${process.env.FURNACE_INSTANCE}/${stackName}-${config.masterPasswordSecret}-${this.environment}`;
        try {
          // const secret = await AwsUtil.getSecret(secretName);
          // config.masterPassword = secret.SecretString;

          return new aws.redshift.Cluster(name, config as aws.redshift.ClusterArgs);
        } catch (e) {
          throw new Error(`unable to find secret ${secretName} specified in resource ${name}`);
        }

      case 'dynamodb.Table':
        config.name = name;
        return new aws.dynamodb.Table(name, config as aws.dynamodb.TableArgs);

      case 'elasticache.Cluster':
        config.clusterId = name;
        return new aws.elasticache.Cluster(name, config as aws.elasticache.ClusterArgs);

      default:
        throw new Error(`unknown resource type ${type}`)
    }
  }

  createRoutingComponent(component: BuildSpec): pulumi.CustomResource {

    const mechanism = this.stackConfig.platform.aws!.defaultRoutingMechanism || "KinesisStream";
    const { name, config } = component;

    switch (mechanism) {
      case "KinesisStream":
        const kinesisConfig: aws.kinesis.StreamArgs = {
          name,
          shardCount: config && config.shards ? config.shards : 1
        }
        return new aws.kinesis.Stream(name, kinesisConfig);

      case "SQS":
        return new aws.sqs.Queue(name, {}) // TODO: add SQS config

      default:
        throw new Error(`unknown routing resource mechanism ${mechanism} when creating routing resource for ${name}`);
    }
  }

  createSourceComponent(source: Source): pulumi.CustomResource {

    const awsConfig = (source.config && source.config.aws ? source.config.aws : {});

    switch (source.type) {
      case SourceType.AwsKinesisStream:
        const streamOptions = {
          source: source.meta!.identifier,
          ...awsConfig
        }

        if (!streamOptions.shardCount) streamOptions.shardCount = 1;

        return new aws.kinesis.Stream(source.meta!.identifier, streamOptions);

      default:
        throw new Error(`unknown source type ${source.type}`);
    }
  }
}

// async run2() {

//   const sources = this.flows.filter(flow => flow.component === "source")
//     , resources = this.flows.filter(flow => flow.component === "resource")
//     ;

//   const stackName = this.config.stack.name

//     , defaultRoutingMechanism = this.config.stack.platform.aws!.defaultRoutingMechanism || "KinesisStream"
//     ;







//   for (let flow of this.flows) {

//     // const firstStep = flow[0];
//     // let inputStreamArn = this.sourceStreamArns.get(firstStep.meta.source!);
//     // if (!inputStreamArn) throw new Error(`unable to find input stream ${firstStep.meta.source!}`)

//     // for (let step of flow) {

//     const resourceName = flow.meta!.identifier!
//       , outputStreamName = flow.meta!.output!
//       , isSink = flow.component === "sink"
//       ;

//     if (!flow.config) flow.config = {};
//     if (!flow.config.aws) flow.config.aws = {};

//     if (flow.type === "Module") {

//     } else {

//       let createdResource: pulumi.Output<string> | undefined;
//       if (flow.resource) {
//         const resource = resources.find(res => res.name === flow.resource);
//         if (!resource) throw new Error(`unable to find resource ${flow.resource} specified in ${flow.name}`);

//         createdResource = createdResources.get(resource.name);

//         if (!createdResource) throw new Error(`unable to get active resource ${resource.name}`);
//       }

//       if (flow.type === "AwsFirehose") {
//         AwsUtil.createFirehose(resourceName, createdResource, flow.config.aws, inputStreamArn);
//       } else {
//         throw new Error(`unknown step type '${flow.type}'`);
//       }

//       this.processIOParameters(flow, createdResource, createdResources);
//     }

//     if (!isSink) {
//       let outputType = defaultRoutingMechanism;

//       const routingResourceArn = AwsUtil.createRoutingResource(outputStreamName, outputType, flow.config);
//       inputStreamArn = routingResourceArn;
//     }
//   }
//   // }
// }

// processIOParameters(step: Model.FlowSpec, resource: any, createdResources: Map<string, any>) {
//   // check if the step has any inputs defined and if so, store them in SSM parameter store
//   if(step.inputs) {
//   for (let input of step.inputs) {
//     const resourceName = input.substring(0, input.indexOf('.'));
//     const resourcePath = input.substring(input.indexOf('.') + 1);
//     const createdResource = createdResources.get(resourceName);

//     if (!createdResource) throw new Error(`Invalid reference in ${step.name} to ${input}`);

//     const secret = new aws.ssm.Parameter(`/${process.env.FURNACE_INSTANCE}/${this.config.stack.name}-${step.name}-${this.environment}/${input}`, {
//       name: `/${process.env.FURNACE_INSTANCE}/${this.config.stack.name}-${step.name}-${this.environment}/${input}`,
//       type: 'SecureString',
//       value: createdResource[resourcePath],
//     });
//   }
// }
//   }
// }