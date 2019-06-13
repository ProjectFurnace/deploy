import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import AwsUtil from "../Util/AwsUtil";
import { PlatformProcessor } from "../IPlatformProcessor";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { RegisteredResource, ResourceConfig } from "../Types";
import AwsResourceFactory from "./AwsResourceFactory";
import ModuleBuilderBase from "../ModuleBuilderBase";
import ResourceUtil from "../Util/ResourceUtil";
import * as util from "util";

export default class AwsProcessor implements PlatformProcessor {

  resourceUtil: ResourceUtil;
  readonly PLATFORM: string = 'aws';

  constructor(private flows: Array<BuildSpec>, private stackConfig: Stack, private environment: string, private buildBucket: string, private initialConfig: any, private moduleBuilder: ModuleBuilderBase | null) {
    this.validate();
    this.resourceUtil = new ResourceUtil(this, this.stackConfig.name, this.environment);
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

    this.resourceUtil.setGlobal({
      stack: {
        name: this.stackConfig.name,
        region: aws.config.region,
        environment: this.environment
      },
      account: {
        id: identity.accountId
      }
    });

    const routingDefs = ResourceUtil.getRoutingDefinitions(this.flows, this.PLATFORM);
    const routingResourceConfigs = routingDefs
      .map(def => this.createRoutingComponent(def.name, def.mechanism, def.config))

    let registeredResources = this.resourceUtil.batchRegister(routingResourceConfigs);

    const resourceConfigs = this.flows
      .filter(flow => flow.componentType === "Resource" && flow.component !== "source")
      .map(flow => this.createResourceComponent(flow))

    const nativeResourceConfigs = this.flows
      .filter(flow => flow.componentType === "NativeResource")
      .map(async flow => await AwsResourceFactory.getNativeResourceConfig(flow, this));

    for(const nativeResourceConfs of nativeResourceConfigs)
      resourceConfigs.push(...await nativeResourceConfs);
  
    const moduleResources: RegisteredResource[] = [];
    const moduleComponents = this.flows.filter(flow => flow.componentType === "Module");

    let pendingModuleConfigs:ResourceConfig[] = [];
    let resources;

    for (const component of moduleComponents) {
      const routingResources = registeredResources.filter(r => component.meta!.sources!.includes(r.name));
      // console.log(component.name, component.meta!.sources, routingResources);
      // if (routingResources.length === 0 && component.component !== "function") throw new Error(`unable to find routing resources in component ${component.name}`);

      [resources, pendingModuleConfigs] = await this.createModuleResource(component, routingResources, identity.accountId);
      resources.forEach(resource => moduleResources.push(resource));
      pendingModuleConfigs.forEach(moduleConfig => resourceConfigs.push(moduleConfig));
    }

    if (resources)
      registeredResources.push(...resources);

    const resourceResources = this.resourceUtil.batchRegister(resourceConfigs, registeredResources);

    return [
      ...registeredResources,
      ...resourceResources,
      ...([] as RegisteredResource[]).concat(...moduleResources) // flatten the moduleResources
    ]
  }

  async createModuleResource(component: BuildSpec, inputResources: RegisteredResource[], accountId: string): Promise<[Array<RegisteredResource>, Array<ResourceConfig>]> {
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
    const functionRoleConfig = this.resourceUtil.configure(ResourceUtil.injectInName(identifier, 'role'), "aws.iam.Role", {
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

    let kinesisResources = component.meta!.sources!.map(source => `arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${source}`);
    if (component.meta!.output) kinesisResources.push(`arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${component.meta!.output}`);

    const rolePolicyDefStatement: aws.iam.PolicyStatement[] = [
      { 
        Effect: "Allow", 
        Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], 
        Resource: `arn:aws:logs:${aws.config.region}:${accountId}:*`  
      },
      {
        Effect: "Allow",
        Action: ["ssm:GetParametersByPath"],
        Resource: [`arn:aws:ssm:${aws.config.region}:${accountId}:parameter/${process.env.FURNACE_INSTANCE}/${identifier}/*`]
      }
    ];

    if (kinesisResources.length > 0) {
      rolePolicyDefStatement.push({ 
        Effect: "Allow", 
        Action: ["kinesis:DescribeStream", "kinesis:PutRecord", "kinesis:PutRecords", "kinesis:GetShardIterator", "kinesis:GetRecords", "kinesis:ListStreams"],
        Resource: kinesisResources
      })
    }

    const rolePolicyDef: aws.iam.RolePolicyArgs = {
      role: role.id,
      policy: {
        Version: "2012-10-17",
        Statement: rolePolicyDefStatement
      }
    };
    
    const rolePolicyConf = this.resourceUtil.configure(ResourceUtil.injectInName(identifier, 'policy'), "aws.iam.RolePolicy", rolePolicyDef, 'resource');
    resources.push(this.resourceUtil.register(rolePolicyConf));

    if (component.policies) {
      for (let p of component.policies) {
        const rolePolicyAttachResourceConfig = this.resourceUtil.configure(ResourceUtil.injectInName(identifier, p), "aws.iam.RolePolicyAttachment", {
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
      variables[param[0].toUpperCase().replace(/'/g, '').replace(/-/g, '_')] = param[1];
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
      memorySize: 256,
      timeout: 60,
      environment: { variables }
    }, 'module'));

    for (let inputResource of inputResources) {
      resourceConfigs.push(this.resourceUtil.configure(ResourceUtil.injectInName(identifier, 'source' + inputResources.indexOf(inputResource)), "aws.lambda.EventSourceMapping", {
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
        , finalConfig = AwsResourceFactory.translateResourceConfig(type!, config) || {}
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

  createRoutingComponent(name: string, mechanism: string | undefined, config: any): ResourceConfig {
    const awsConfig = (this.stackConfig.platform && this.stackConfig.platform.aws) || {}
      , defaultRoutingMechanism = awsConfig.defaultRoutingMechanism || "aws.kinesis.Stream"
      , defaultRoutingShards = awsConfig.defaultRoutingShards || 1
      ;

    if (!mechanism) mechanism = defaultRoutingMechanism;
    if (!name) throw new Error(`unable to get name for routing resource for component: '${name}'`);

    if (mechanism === "aws.kinesis.Stream") {
      if (!config.shardCount) config.shardCount = defaultRoutingShards || 1; // TODO: allow shards to be set in config
    }

    return this.resourceUtil.configure(name, mechanism, config, 'resource');
  }

  getResource(config: ResourceConfig): [any, any] {
    const [provider, newConfig] = AwsResourceFactory.getResource(config.name, config.type, config.config);

    return [provider, newConfig];
  }

  processOutputs(name: string, resource: any, outputs: any) {
    // check if the step has any inputs defined and if so, store them in SSM parameter store
    if (outputs) {
      const REGEX = /(\w+)-([\w_-]+)-(\w+)/;
      const name_bits = REGEX.exec(name);

      if (name_bits) {
        let secretsConfig:ResourceConfig[] = [];
        for (const key in outputs) {
          secretsConfig.push(this.resourceUtil.configure(`/${process.env.FURNACE_INSTANCE}/${name_bits[1]}/${name_bits[2]}.${key}/${name_bits[3]}`, 'aws.ssm.Parameter', {
            name: `/${process.env.FURNACE_INSTANCE}/${name_bits[1]}/${name_bits[2]}.${key}/${name_bits[3]}`,
            type: 'SecureString',
            value: resource[outputs[key]],
          }, 'resource'));
        }
        this.resourceUtil.batchRegister(secretsConfig);
      }
    }
  }
}