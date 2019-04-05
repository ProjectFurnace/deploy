import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import AwsValidator from "./Validation/AwsValidator";
import AwsUtil from "./Util/AwsUtil";
import { PlatformProcessor } from "./IPlatformProcessor";
import { Source, BuildSpec, SourceType, Stack } from "@project-furnace/stack-processor/src/Model";
import { RegisteredResource } from "./Types";
import AwsResourceFactory from "./AwsResourceFactory";
import ModuleBuilderBase from "./ModuleBuilderBase";

export default class AwsProcessor implements PlatformProcessor {

  constructor(private flows: Array<BuildSpec>, private stackConfig: Stack, private environment: string, private buildBucket: string, private initialConfig: any, private moduleBuilder: ModuleBuilderBase | null) {
    this.validate();
  }

  validate() {
    if (!this.flows) throw new Error("flows must be set");
    if (!this.stackConfig) throw new Error("stackConfig must be set");
    if (!this.environment) throw new Error("environment must be set");
    if (!this.buildBucket) throw new Error("buildBucket must be set");

    // const errors = AwsValidator.validate(config, flows);
    // if (errors.length > 0) throw new Error(JSON.stringify(errors));
  }

  async preProcess(): Promise<Array<RegisteredResource>> {
    return [];
  }

  async process(): Promise<Array<RegisteredResource>> {

    const identity: aws.GetCallerIdentityResult = this.initialConfig.identity;

    const routingResources = this.flows
      .filter(flow => !["sink", "resource"].includes(flow.component))
      .map(flow => this.createRoutingComponent(flow));

    const resourceResources = this.flows
      .filter(flow => flow.component === "resource")
      .map(flow => this.createResourceComponent(flow));

    const moduleResources = this.flows
      .filter(flow => flow.componentType === "Module")
      .map(flow => {
        const routingResource = routingResources.find(r => r.name === flow.meta!.source)
        if (!routingResource) throw new Error(`unable to find routing resource ${flow.meta!.source} in flow ${flow.name}`);
        return this.createModuleResource(flow, routingResource ,identity.accountId);
      });   

    return [ 
      ...routingResources,
      ...resourceResources,
      ...([] as RegisteredResource[]).concat(...moduleResources) // flatten the moduleResources
    ]

  }

  createModuleResource(component: BuildSpec, inputResource: RegisteredResource, accountId: string): Array<RegisteredResource> {
    
    const stackName = this.stackConfig.name;
    const { identifier } = component.meta!;
    const awsConfig = component.config.aws || {};

    const resources: Array<RegisteredResource> = [];

    const defaultBatchSize = this.stackConfig.platform.aws!.defaultBatchSize || 1
        , defaultStartingPosition = this.stackConfig.platform.aws!.defaultStartingPosition || "LATEST"
        ;

    if (!component.moduleSpec || !component.moduleSpec.runtime) throw new Error(`module component ${component.name} has no runtime set`);
    
    const functionRoleResource = this.register(`${identifier}-role`, aws.iam.Role, {
      assumeRolePolicy: JSON.stringify({
          "Version": "2012-10-17",
          "Statement": [
              {
                  "Action": "sts:AssumeRole",
                  "Principal": {
                      "Service": "lambda.amazonaws.com",
                  },
                  "Effect":  "Allow",
                  "Sid": "",
              },
          ],
      })
    });

    resources.push(functionRoleResource);

    // resources.push(this.register(`${identifier}-policy`, aws.iam.RolePolicy, {
    //   assumeRolePolicy: JSON.stringify({
    //       "Version": "2012-10-17",
    //       "Statement": [
    //           {
    //               "Action": "sts:AssumeRole",
    //               "Principal": {
    //                   "Service": "lambda.amazonaws.com",
    //               },
    //               "Effect":  "Allow",
    //               "Sid": "",
    //           },
    //       ],
    //   })
    // }));

    // resources.push(AwsUtil.createSimpleIamRolePolicy(, role.id, [
    //   {
    //     resource: `arn:aws:logs:${aws.config.region}:${accountId}:*`,
    //     actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    //   },
    //   {
    //     resource: [`arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${component.meta!.source}`, `arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${component.meta!.output}`],
    //     actions: ["kinesis:DescribeStream", "kinesis:PutRecord", "kinesis:PutRecords", "kinesis:GetShardIterator", "kinesis:GetRecords", "kinesis:ListStreams"]
    //   },
    //   {
    //     resource: [`arn:aws:ssm:${aws.config.region}:${accountId}:parameter/${process.env.FURNACE_INSTANCE}/${identifier}/*`],
    //     actions: ["ssm:GetParametersByPath"]
    //   }
    // ]));

    // if (component.policies) {
    //   for (let p of component.policies) {
    //     new aws.iam.RolePolicyAttachment(`${identifier}-${p}`, {
    //       role,
    //       policyArn: `arn:aws:iam::aws:policy/${p}`
    //     })
    //   }
    // }

    const variables: { [key: string]: string } = {
      "STACK_NAME": stackName || "unknown",
      "STACK_ENV": this.environment || "unknown",
      "FURNACE_INSTANCE": process.env.FURNACE_INSTANCE || "unknown"
    };

    for (let param of component.parameters) {
      variables[param[0].toUpperCase().replace("'", "").replace("-", "_")] = param[1];
    }

    if (component.component !== "sink") {
      variables["STREAM_NAME"] = component.meta!.output!;
      variables["PARTITION_KEY"] = (awsConfig.partitionKey) || "DEFAULT";
    }

    if (component.logging === "debug") variables["DEBUG"] = "1";

    resources.push(this.register(identifier, aws.lambda.Function, {
      name: identifier,
      handler: "handler.handler",
      role: (functionRoleResource.resource as aws.iam.Role).arn,
      runtime: AwsUtil.runtimeFromString(component.moduleSpec.runtime ? component.moduleSpec.runtime : "nodejs8.10"),
      s3Bucket: this.buildBucket,
      s3Key: `${component.module}/${component.buildSpec!.hash}`,
      environment: { variables }
    }));

    resources.push(this.register(identifier + "-source", aws.lambda.EventSourceMapping, {
        eventSourceArn: (inputResource.resource as any).arn,
        functionName: identifier,
        enabled: true,
        batchSize: awsConfig.batchSize || defaultBatchSize,
        startingPosition: awsConfig.startingPosition || defaultStartingPosition,
      }
    ));

    // this.processIOParameters(flow, lambda, createdResources);
    return resources;
  }

  createResourceComponent(component: BuildSpec): RegisteredResource {

    const name = component.meta!.identifier
      , stackName = this.stackConfig.name
      , { type, config } = component
      ;

      // TODO: can we wrap secrets into a generic mechanism
    switch (type) {
      case 'aws.redshift.Cluster':
        const secretName = `${process.env.FURNACE_INSTANCE}/${stackName}-${config.masterPasswordSecret}-${this.environment}`;
        
        try {
          // const secret = await AwsUtil.getSecret(secretName);
          // config.masterPassword = secret.SecretString;
        } catch (e) {
          throw new Error(`unable to find secret ${secretName} specified in resource ${name}`);
        }
    }

    const [resource, finalConfig] = AwsResourceFactory.getResource(name, type!, config);
    return this.register(name, resource, finalConfig);
  }

  createRoutingComponent(component: BuildSpec): RegisteredResource {

    const awsConfig = this.stackConfig.platform.aws || {}
        , defaultRoutingMechanism = awsConfig.defaultRoutingMechanism || "aws.kinesis.Stream"
        , defaultRoutingShards = awsConfig.defaultRoutingShards || 1
        ;

    let name = component.meta && component.meta!.output!
      , mechanism = defaultRoutingMechanism
      , config: any = {}
      ;

    if (component.component === "source") {
      name = component.meta!.identifier;
      mechanism = component.type || defaultRoutingMechanism;
      config = component.config.aws || {}
    }

    if (!name) throw new Error(`unable to get name for routing resource for component: '${component.name}'`);

    if (mechanism === "aws.kinesis.Stream") {
      if (!config.shardCount) config.shardCount = defaultRoutingShards || 1; // TODO: allow shards to be set in config
    }

    const [resource, finalConfig] = AwsResourceFactory.getResource(name, mechanism, config);
    return this.register(name, resource, finalConfig);
  }

  register(name: string, resource: any, config: any): RegisteredResource {

    try {

      const instance = new resource(name, config) as pulumi.CustomResource;
      return {
        name,
        type: instance.constructor.name,
        resource: instance
      }
    } catch (err) {
      throw new Error(`unable to create resource ${name}: ${err}`);
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