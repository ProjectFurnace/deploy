import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import AwsValidator from "../Validation/AwsValidator";
import AwsUtil from "../Util/AwsUtil";
import { PlatformProcessor } from "../IPlatformProcessor";
import { Source, BuildSpec, SourceType, Stack } from "@project-furnace/stack-processor/src/Model";
import { RegisteredResource } from "../Types";
import AwsResourceFactory from "./AwsResourceFactory";
import ModuleBuilderBase from "../ModuleBuilderBase";

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
      .filter(flow => !["sink", "resource", "connector"].includes(flow.component))
      .map(flow => this.createRoutingComponent(flow));

    const resourceResources = this.flows
      .filter(flow => flow.component === "resource")
      .map(flow => this.createResourceComponent(flow));

    const nativeResources = this.flows
      .filter(flow => flow.componentType === "NativeResource")
      .map(flow => this.createNativeResourceComponent(flow));

    const moduleResources: RegisteredResource[] = [];
    const moduleComponents = this.flows.filter(flow => flow.componentType === "Module");

    for (const component of moduleComponents) {

      const routingResource = routingResources.find(r => r.name === component.meta!.source)
      if (!routingResource) throw new Error(`unable to find routing resource ${component.meta!.source} in flow ${component.name}`);

      const resources = await this.createModuleResource(component, routingResource, identity.accountId);
      resources.forEach(resource => moduleResources.push(resource));
    }

    return [
      ...routingResources,
      ...resourceResources,
      ...nativeResources,
      ...([] as RegisteredResource[]).concat(...moduleResources) // flatten the moduleResources
    ]
  }

  flattenResourceArray(resources: RegisteredResource[][]): RegisteredResource[] {
    return [...([] as RegisteredResource[]).concat(...resources)];
  }

  async createModuleResource(component: BuildSpec, inputResource: RegisteredResource, accountId: string): Promise<Array<RegisteredResource>> {

    const stackName = this.stackConfig.name
      , { identifier } = component.meta!
      , { componentType } = component
      , awsConfig = component.config.aws || {}
      , platformConfig: any = (this.stackConfig.platform && this.stackConfig.platform.aws) || {}

    const resources: Array<RegisteredResource> = [];

    const defaultBatchSize = platformConfig.defaultBatchSize || 1
      , defaultStartingPosition = platformConfig.defaultStartingPosition || "LATEST"
      ;

    if (!component.moduleSpec || !component.moduleSpec.runtime) throw new Error(`module component ${component.name} has no runtime set`);

    await this.moduleBuilder!.initialize();
    const buildDef = await this.moduleBuilder!.processModule(component);

    const s3Key = `${component.module!}/${component.buildSpec!.hash}`
    await this.moduleBuilder!.uploadArtifcat(this.buildBucket, s3Key, buildDef.buildArtifact)

    const functionRoleResource = this.register(`${identifier}-role`, componentType, "aws.iam.Role", {
      assumeRolePolicy: JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [
          {
            "Action": "sts:AssumeRole",
            "Principal": {
              "Service": "lambda.amazonaws.com",
            },
            "Effect": "Allow",
            "Sid": "",
          },
        ],
      })
    });

    resources.push(functionRoleResource);
    const role = (functionRoleResource.resource as aws.iam.Role);

    const rolePolicyDef: aws.iam.RolePolicyArgs = {
      role: role.id,
      policy: {
        Version: "2012-10-17",
        Statement: [
          { 
            Effect: "Allow", 
            Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], 
            Resource: `arn:aws:logs:${aws.config.region}:${accountId}:*`  
          },
          { 
            Effect: "Allow", 
            Action: ["kinesis:DescribeStream", "kinesis:PutRecord", "kinesis:PutRecords", "kinesis:GetShardIterator", "kinesis:GetRecords", "kinesis:ListStreams"],
            Resource: [`arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${component.meta!.source}`, `arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${component.meta!.output}`]
          },
          {
            Effect: "Allow",
            Action: ["ssm:GetParametersByPath"],
            Resource: [`arn:aws:ssm:${aws.config.region}:${accountId}:parameter/${process.env.FURNACE_INSTANCE}/${identifier}/*`]
          }
        ]
      }
    };
    resources.push(this.register(`${identifier}-policy`, componentType, "aws.iam.RolePolicy", rolePolicyDef));

    if (component.policies) {
      for (let p of component.policies) {
        resources.push(this.register(`${identifier}-${p}`, componentType, "aws.iam.RolePolicyAttachment", {
          role,
          policyArn: `arn:aws:iam::aws:policy/${p}`
        } as aws.iam.RolePolicyAttachmentArgs))
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
      variables["STREAM_NAME"] = component.meta!.output!;
      variables["PARTITION_KEY"] = (awsConfig.partitionKey) || "DEFAULT";
    }

    if (component.logging === "debug") variables["DEBUG"] = "1";

    resources.push(this.register(identifier, componentType, "aws.lambda.Function", {
      name: identifier,
      handler: "handler.handler",
      role: (functionRoleResource.resource as aws.iam.Role).arn,
      runtime: AwsUtil.runtimeFromString(component.moduleSpec.runtime ? component.moduleSpec.runtime : "nodejs8.10"),
      s3Bucket: this.buildBucket,
      s3Key,
      environment: { variables }
    }));

    resources.push(this.register(identifier + "-source", componentType, "aws.lambda.EventSourceMapping", {
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
      , { type, config, componentType } = component
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

    return this.register(name, componentType, type!, config);
  }

  createNativeResourceComponent(component: BuildSpec): RegisteredResource {
    const name = component.meta!.identifier
      , { type, config, componentType } = component
      ;


    return this.register(name, componentType, type!, config);
  }

  createRoutingComponent(component: BuildSpec): RegisteredResource {

    const awsConfig = (this.stackConfig.platform && this.stackConfig.platform.aws) || {}
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
      config = (component.config && component.config.aws) || {}
    }

    if (!name) throw new Error(`unable to get name for routing resource for component: '${component.name}'`);

    if (mechanism === "aws.kinesis.Stream") {
      if (!config.shardCount) config.shardCount = defaultRoutingShards || 1; // TODO: allow shards to be set in config
    }

    return this.register(name, "Resource", mechanism, config);
  }

  register(name: string, componentType: string, type: string, config: any): RegisteredResource {

    try {
      let resource, newConfig;

      switch (componentType) {
        case "NativeResource":
          [resource, newConfig] = AwsResourceFactory.getNativeResource(name, type, config);
          break;
        default:
          [resource, newConfig] = AwsResourceFactory.getResource(name, type, config);
      }

      const instance = new resource(name, newConfig) as pulumi.CustomResource;

      return {
        name,
        type,
        resource: instance
      }
    } catch (err) {
      throw new Error(`unable to create resource ${name} of type ${type}: ${err}`);
    }
  }

  // register(name: string, resource: any, config: any): RegisteredResource {

  //   try {

  //     const instance = new resource(name, config) as pulumi.CustomResource;
  //     return {
  //       name,
  //       type: instance.constructor.name,
  //       resource: instance
  //     }
  //   } catch (err) {
  //     throw new Error(`unable to create resource ${name}: ${err}`);
  //   }
  // }
}

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