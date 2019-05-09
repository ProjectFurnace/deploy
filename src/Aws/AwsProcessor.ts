import * as aws from "@pulumi/aws";
import AwsUtil from "../Util/AwsUtil";
import { PlatformProcessor } from "../IPlatformProcessor";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { RegisteredResource, ResourceConfig } from "../Types";
import AwsResourceFactory from "./AwsResourceFactory";
import ModuleBuilderBase from "../ModuleBuilderBase";
import ResourceUtil from "../Util/ResourceUtil";

export default class AwsProcessor implements PlatformProcessor {

  resourceUtil: ResourceUtil;
  readonly PLATFORM: string = 'aws';
  resourceFactory: AwsResourceFactory;

  constructor(private flows: Array<BuildSpec>, private stackConfig: Stack, private environment: string, private buildBucket: string, private initialConfig: any, private moduleBuilder: ModuleBuilderBase | null) {
    this.validate();
    this.resourceUtil = new ResourceUtil(this, this.stackConfig.name, this.environment);
    this.resourceFactory = new AwsResourceFactory();
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
      .filter(flow => !["sink", "resource", "connector", "function"].includes(flow.component))
      .map(flow => this.createRoutingComponent(flow));

    const resourceConfigs = this.flows
      .filter(flow => flow.component === "resource")
      .map(flow => this.createResourceComponent(flow));

    const nativeResourceConfigs = this.flows
      .filter(flow => flow.componentType === "NativeResource")
      .map(flow => this.createNativeResourceComponent(flow));

    resourceConfigs.push(...nativeResourceConfigs);
  
    const moduleResources: RegisteredResource[] = [];
    const moduleComponents = this.flows.filter(flow => flow.componentType === "Module");

    let pendingModuleConfigs:ResourceConfig[] = [];
    let resources;

    for (const component of moduleComponents) {
      const routingResource = routingResources.find(r => r.name === component.meta!.source)
      if (!routingResource && component.component !== "function") throw new Error(`unable to find routing resource ${component.meta!.source} in flow ${component.name}`);

      [resources, pendingModuleConfigs] = await this.createModuleResource(component, routingResource, identity.accountId);
      resources.forEach(resource => moduleResources.push(resource));
      pendingModuleConfigs.forEach(moduleConfig => resourceConfigs.push(moduleConfig));
    }
    
    const resourceResources = this.resourceUtil.batchRegister(resourceConfigs);

    return [
      ...routingResources,
      ...resourceResources,
      ...([] as RegisteredResource[]).concat(...moduleResources) // flatten the moduleResources
    ]
  }

  async createModuleResource(component: BuildSpec, inputResource: RegisteredResource | undefined, accountId: string): Promise<[Array<RegisteredResource>, Array<ResourceConfig>]> {
    const stackName = this.stackConfig.name
      , { identifier } = component.meta!
      , { componentType } = component
      , awsConfig = component.config.aws || {}
      , platformConfig: any = (this.stackConfig.platform && this.stackConfig.platform.aws) || {}

    const resources: Array<RegisteredResource> = [];
    const resourceConfigs: Array<ResourceConfig> = [];

    const defaultBatchSize = platformConfig.defaultBatchSize || 1
      , defaultStartingPosition = platformConfig.defaultStartingPosition || "LATEST"
      ;

    if (!component.moduleSpec || !component.moduleSpec.runtime) throw new Error(`module component ${component.name} has no runtime set`);

    await this.moduleBuilder!.initialize();
    const buildDef = await this.moduleBuilder!.processModule(component);

    const s3Key = `${component.module!}/${component.buildSpec!.hash}`
    await this.moduleBuilder!.uploadArtifcat(this.buildBucket, s3Key, buildDef.buildArtifact)

  // TODO: use role helper below
  //   const role = new aws.iam.Role("mylambda-role", {
  //     assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ "Service": ["lambda.amazonaws.com"] }),
  // });
    const functionRoleConfig = this.resourceUtil.configure(`${identifier}-role`, "aws.iam.Role", {
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
    }, 'resource');
    const functionRoleResource = this.resourceUtil.register(functionRoleConfig);

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
    const rolePolicyConf = this.resourceUtil.configure(`${identifier}-policy`, "aws.iam.RolePolicy", rolePolicyDef, 'resource');
    resources.push(this.resourceUtil.register(rolePolicyConf));

    if (component.policies) {
      for (let p of component.policies) {
        const rolePolicyAttachResourceConfig = this.resourceUtil.configure(`${identifier}-${p}`, "aws.iam.RolePolicyAttachment", {
          role,
          policyArn: `arn:aws:iam::aws:policy/${p}`
        } as aws.iam.RolePolicyAttachmentArgs, 'resource');
        resources.push(this.resourceUtil.register(rolePolicyAttachResourceConfig));
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
    
    resourceConfigs.push(this.resourceUtil.configure(identifier, "aws.lambda.Function", {
      name: identifier,
      handler: "handler.handler",
      role: (functionRoleResource.resource as aws.iam.Role).arn,
      runtime: AwsUtil.runtimeFromString(component.moduleSpec.runtime ? component.moduleSpec.runtime : "nodejs8.10"),
      s3Bucket: this.buildBucket,
      s3Key,
      environment: { variables }
    }, 'module'));

    if (inputResource) {  
      resourceConfigs.push(this.resourceUtil.configure(identifier + "-source", "aws.lambda.EventSourceMapping", {
        eventSourceArn: (inputResource.resource as any).arn,
        functionName: identifier,
        enabled: true,
        batchSize: awsConfig.batchSize || defaultBatchSize,
        startingPosition: awsConfig.startingPosition || defaultStartingPosition,
      }, 'resource'));
    }

    return [resources, resourceConfigs];
  }

  createResourceComponent(component: BuildSpec): ResourceConfig {
    const name = component.meta!.identifier
        , stackName = this.stackConfig.name
        , { type, config, componentType } = component
        , finalConfig = this.resourceFactory.translateResourceConfig(type!, config) || {}
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
    return this.resourceUtil.configure(name, type!, finalConfig, 'resource', {}, component.outputs, componentType);
  }

  createNativeResourceComponent(component: BuildSpec): ResourceConfig {
    const name = component.meta!.identifier
      , { type, config, componentType } = component
      ;

    return this.resourceUtil.configure(name, type!, config, 'resource', {}, {}, componentType);
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

    const routingComponentConfig = this.resourceUtil.configure(name, mechanism, config, 'resource');
    return this.resourceUtil.register(routingComponentConfig);
  }

  getResource(config: ResourceConfig): [any, any] {
    let provider, newConfig;

    switch (config.componentType) {
      case "NativeResource":
        [provider, newConfig] = this.resourceFactory.getNativeResource(config.name, config.type, config.config);
        break;
      default:
        [provider, newConfig] = this.resourceFactory.getResource(config.name, config.type, config.config);
    }

    return [provider, newConfig];
  }

  processOutputs(name: string, resource: any, outputs: any) {
    // check if the step has any inputs defined and if so, store them in SSM parameter store
    if (outputs) {
      let secretsConfig:ResourceConfig[] = [];
      for (const key in outputs) {
        secretsConfig.push(this.resourceUtil.configure(`/${process.env.FURNACE_INSTANCE}/${name}/${key}`, 'aws.ssm.Parameter', {
          name: `/${process.env.FURNACE_INSTANCE}/-${name}/${key}`,
          type: 'SecureString',
          value: resource[outputs[key]],
        }, 'resource'));
      }
      this.resourceUtil.batchRegister(secretsConfig);
    }
  }
}