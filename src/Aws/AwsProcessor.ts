import {
  BuildSpec,
  Stack,
  Tap
} from "@project-furnace/stack-processor/src/Model";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as _ from "lodash";
import FunctionBuilderBase from "../FunctionBuilderBase";
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource, ResourceConfig } from "../Types";
import AwsUtil from "../Util/AwsUtil";
import ResourceUtil from "../Util/ResourceUtil";
import AwsResourceFactory from "./AwsResourceFactory";

export default class AwsProcessor implements PlatformProcessor {
  public resourceUtil: ResourceUtil;
  private readonly PLATFORM: string = "aws";
  private apigwRestApi: RegisteredResource;

  constructor(
    private flows: BuildSpec[],
    private stackConfig: Stack,
    private environment: string,
    private buildBucket: string,
    private initialConfig: any,
    private functionBuilder: FunctionBuilderBase | null
  ) {
    this.validate();
    this.resourceUtil = new ResourceUtil(
      this,
      this.stackConfig.name,
      this.environment
    );
  }

  public async preProcess(): Promise<RegisteredResource[]> {
    return [];
  }

  public async process(): Promise<RegisteredResource[]> {
    const identity: aws.GetCallerIdentityResult = this.initialConfig.identity;

    this.resourceUtil.setGlobal({
      account: {
        id: identity.accountId
      },
      stack: {
        environment: this.environment,
        name: this.stackConfig.name,
        region: aws.config.region
      }
    });

    let routingDefs = ResourceUtil.getRoutingDefinitions(
      this.flows,
      this.PLATFORM
    );

    const functionComponents = this.flows.filter(
      flow => flow.functionSpec !== undefined
    );

    const routingResourceConfigsPromises = [];
    routingResourceConfigsPromises.push(...await Promise.all(routingDefs.map(def => this.createRoutingComponent(def.name, def.mechanism, def.config))));

    const routingResourceConfigs = [];
    for (const prom of routingResourceConfigsPromises) {
      routingResourceConfigs.push(...prom);
    }

    /*const routingResourceConfigs = [];
    routingResourceConfigs.push(...await Promise.all(routingResourceConfigsPromises));*/

    const registeredResources = await this.resourceUtil.batchRegister(
      routingResourceConfigs,
    );

    const resourceConfigsPromises = this.flows
      .filter(flow => ["resource", "connector"].includes(flow.construct))
      .map(flow => AwsResourceFactory.getResourceConfig(flow, this));

    const resourceConfigs = [];

    for (const resourceConfigsPromise of resourceConfigsPromises) {
      resourceConfigs.push(...(await resourceConfigsPromise));
    }

    const functionResources: RegisteredResource[] = [];

    let pendingFunctionConfigs: ResourceConfig[] = [];
    let resources;

    for (const component of functionComponents) {
      const routingResources = registeredResources.filter(r =>
        component.meta!.sources!.includes(r.name)
      );
      const outputRoutingResources = registeredResources.filter(
        r => component.meta!.output! === r.name
      );

      [resources, pendingFunctionConfigs] = await this.createFunctionResource(
        component,
        routingResources,
        outputRoutingResources,
        identity.accountId
      );
      resources.forEach(resource => functionResources.push(resource));
      pendingFunctionConfigs.forEach(functionConfig =>
        resourceConfigs.push(functionConfig)
      );
    }

    if (resources) {
      registeredResources.push(...resources);
    }

    const resourceResources = await this.resourceUtil.batchRegister(
      resourceConfigs,
      registeredResources
    );

    return [
      ...registeredResources,
      ...resourceResources,
      ...([] as RegisteredResource[]).concat(...functionResources) // flatten the functionResources
    ];
  }

  public processOutputs(name: string, resource: any, outputs: any) {
    // check if the step has any inputs defined and if so, store them in SSM parameter store
    if (outputs) {
      const nameBits = ResourceUtil.getBits(name);

      if (nameBits) {
        const secretsConfig: ResourceConfig[] = [];
        for (const key in outputs) {
          secretsConfig.push(
            this.resourceUtil.configure(
              `/${process.env.FURNACE_INSTANCE}/${nameBits[1]}/${nameBits[2]}.${key}/${nameBits[3]}`,
              "aws.ssm.Parameter",
              {
                name: `/${process.env.FURNACE_INSTANCE}/${nameBits[1]}/${nameBits[2]}.${key}/${nameBits[3]}`,
                type: "SecureString",
                value: resource[outputs[key]]
              },
              "resource"
            )
          );
        }
        this.resourceUtil.batchRegister(secretsConfig);
      }
    }
  }

  public getResource(config: ResourceConfig): any {
    return AwsResourceFactory.getResourceProvider(config.type);
  }

  private async createFunctionResource(
    component: BuildSpec,
    inputResources: RegisteredResource[],
    outputResources: RegisteredResource[],
    accountId: string
  ): Promise<[RegisteredResource[], ResourceConfig[]]> {
    const stackName = this.stackConfig.name;
    const { identifier } = component.meta!;
    const identifierBaseName = ResourceUtil.getBits(identifier)[2];
    const awsConfig = component.config.aws || {};
    const platformConfig: any =
      (this.stackConfig.platform && this.stackConfig.platform.aws) || {};

    const resources: RegisteredResource[] = [];
    const resourceConfigs: ResourceConfig[] = [];

    const defaultBatchSize = platformConfig.defaultBatchSize || 10;
    const defaultStartingPosition =
      platformConfig.defaultStartingPosition || "LATEST";

    if (!component.functionSpec || !component.functionSpec.runtime) {
      throw new Error(
        `function component ${component.name} has no runtime set`
      );
    }

    await this.functionBuilder!.initialize();

    const buildDef = await this.functionBuilder!.processFunction(component);

    const s3Key = `${component.meta!.identifier}/${component.buildSpec!.hash}`;
    if (!pulumi.runtime.isDryRun()) {
      await this.functionBuilder!.uploadArtifcat(
        this.buildBucket,
        s3Key,
        buildDef.buildArtifact
      );
    }

    // TODO: use role helper below
    //   const role = new aws.iam.Role("mylambda-role", {
    //     assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ "Service": ["lambda.amazonaws.com"] }),
    // });
    const functionRoleConfig = this.resourceUtil.configure(
      ResourceUtil.injectInName(identifier, "role"),
      "aws.iam.Role",
      {
        assumeRolePolicy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: {
                Service: "lambda.amazonaws.com"
              },
              Sid: ""
            }
          ]
        })
      },
      "resource"
    );
    const functionRoleResource = await this.resourceUtil.register(
      functionRoleConfig
    );

    resources.push(functionRoleResource);
    const role = functionRoleResource.resource as aws.iam.Role;

    const kinesisResources: any = [];
    const sqsResources: any = [];
    const s3bucketResources: any = [];

    if (component.meta!.sources!) {
      var previousType;
      for (const source of component.meta!.sources!) {
        const inputRes = inputResources.find(r => r.name === source);
        if (inputRes) {
          if (previousType && previousType !== inputRes.type) {
            throw new Error(
              `Component ${identifier} cannot have different source types`
            );
          }
          previousType = inputRes.type;
          switch (inputRes.type) {
            case "aws.kinesis.Stream":
              kinesisResources.push(
                `arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${source}`
              );
              break;

            case "aws.sqs.Queue":
              sqsResources.push(
                `arn:aws:sqs:${aws.config.region}:${accountId}:${source}`
              );
              break;

            case "aws.cloudwatch.EventRule":
            case "aws.s3.Bucket":
            case "aws.apigateway.Resource":
              break;

            default:
              throw new Error(
                `Unsupported type ${inputRes.type} for source ${source}`
              );
          }
        }
      }
    }

    if (component.meta!.output) {
      var outputRes = outputResources.find(
        r => r.name === component.meta!.output
      );
      if (outputRes) {
        switch (outputRes.type) {
          case "aws.kinesis.Stream":
            kinesisResources.push(
              `arn:aws:kinesis:${aws.config.region}:${accountId}:stream/${
                component.meta!.output
              }`
            );
            break;

          case "aws.sqs.Queue":
            sqsResources.push(
              `arn:aws:sqs:${aws.config.region}:${accountId}:${
                component.meta!.output
              }`
            );
            break;

          default:
            throw new Error(
              `Unsupported type ${outputRes.type} for output ${
                component.meta!.output
              }`
            );
        }
      }
    }

    const rolePolicyDefStatement: aws.iam.PolicyStatement[] = [
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        Resource: `arn:aws:logs:${aws.config.region}:${accountId}:*`
      },
      {
        Effect: "Allow",
        Action: ["ssm:GetParametersByPath"],
        Resource: [
          `arn:aws:ssm:${aws.config.region}:${accountId}:parameter/${process.env.FURNACE_INSTANCE}/${identifier}/*`
        ]
      }
    ];

    if (kinesisResources.length > 0) {
      rolePolicyDefStatement.push({
        Action: [
          "kinesis:DescribeStream",
          "kinesis:PutRecord",
          "kinesis:PutRecords",
          "kinesis:GetShardIterator",
          "kinesis:GetRecords",
          "kinesis:ListStreams"
        ],
        Effect: "Allow",
        Resource: kinesisResources
      });
    }

    if (sqsResources.length > 0) {
      rolePolicyDefStatement.push({
        Action: [
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:DeleteMessageBatch",
          "sqs:SendMessage",
          "sqs:SendMessageBatch"
        ],
        Effect: "Allow",
        Resource: sqsResources
      });
    }

    const rolePolicyDef: aws.iam.RolePolicyArgs = {
      policy: {
        Statement: rolePolicyDefStatement,
        Version: "2012-10-17"
      },
      role: role.id
    };

    const rolePolicyConf = this.resourceUtil.configure(
      ResourceUtil.injectInName(identifier, "policy"),
      "aws.iam.RolePolicy",
      rolePolicyDef,
      "resource"
    );
    resources.push(await this.resourceUtil.register(rolePolicyConf));

    if (component.policies) {
      for (const p of component.policies) {
        const rolePolicyAttachResourceConfig = this.resourceUtil.configure(
          ResourceUtil.injectInName(identifier, p),
          "aws.iam.RolePolicyAttachment",
          {
            policyArn: `arn:aws:iam::aws:policy/${p}`,
            role
          } as aws.iam.RolePolicyAttachmentArgs,
          "resource"
        );
        resources.push(
          await this.resourceUtil.register(rolePolicyAttachResourceConfig)
        );
      }
    }

    const variables: { [key: string]: string } = {
      FURNACE_INSTANCE: process.env.FURNACE_INSTANCE || "undefined",
      STACK_ENV: this.environment || "undefined",
      STACK_NAME: stackName || "undefined"
    };

    // we have a combined function
    if (component.functionSpec.functions.length > 1) {
      variables.COMBINE = "";

      for (const func of component.functionSpec.functions) {
        variables.COMBINE = variables.COMBINE.concat(func.function, ",");
      }
      // remove last comma - there's probably a fancier way to do this...
      variables.COMBINE = variables.COMBINE.substring(
        0,
        variables.COMBINE.length - 1
      );
    }

    for (const param of component.functionSpec.functions[0].parameters || []) {
      variables[
        param[0]
          .toUpperCase()
          .replace(/'/g, "")
          .replace(/-/g, "_")
      ] = param[1];
    }

    if (component.construct !== "sink") {
      variables.STREAM_NAME = component.meta!.output!;
      variables.PARTITION_KEY = awsConfig.partitionKey || "DEFAULT";
    }

    if (component.logging === "debug") {
      variables.DEBUG = "1";
    }

    if (outputRes && component.meta!.output) {
      // if input and output are different, and the input is not a timer
      /*if (
        previousType !== outputRes.type &&
        previousType !== "aws.cloudwatch.EventRule"
      ) {*/
        variables.OUTPUT_TYPE = outputRes.type;
      //}
    }

    const lambdaConfig = this.resourceUtil.configure(
      identifier,
      "aws.lambda.Function",
      {
        name: identifier,
        handler: "handler.handler",
        role: (functionRoleResource.resource as aws.iam.Role).arn,
        runtime: AwsUtil.runtimeFromString(
          component.functionSpec.runtime
            ? component.functionSpec.runtime
            : "nodejs8.10"
        ),
        s3Bucket: this.buildBucket,
        s3Key,
        memorySize: 256,
        timeout: 60,
        environment: { variables }
      },
      "function"
    );

    //const lambda = this.resourceUtil.register(lambdaConfig);
    //resources.push(lambda);
    resourceConfigs.push(lambdaConfig);

    for (const inputResource of inputResources) {
      const sourceMappingConfig: any = {
        batchSize: awsConfig.batchSize || defaultBatchSize,
        enabled: true,
        eventSourceArn: (inputResource.resource as any).arn,
        //eventSourceArn: `arn:aws:sqs:${aws.config.region}:${accountId}:${inputResource.name}`,
        functionName: identifier
      };

      if (inputResource.type === "aws.kinesis.Stream") {
        sourceMappingConfig.startingPosition =
          awsConfig.startingPosition || defaultStartingPosition;
      }

      switch (inputResource.type) {
        case "aws.kinesis.Stream":
        case "aws.sqs.Queue":
          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(
                identifier,
                "source" + inputResources.indexOf(inputResource)
              ),
              "aws.lambda.EventSourceMapping",
              sourceMappingConfig,
              "resource"
            )
          );
          break;

        case "aws.cloudwatch.EventRule":
          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(identifier, "eventTarget"),
              "aws.cloudwatch.EventTarget",
              {
                //arn: (lambda.resource as aws.lambda.Function).arn,
                arn: "${" + identifierBaseName + ".arn}",
                rule: inputResource.name
              } as aws.cloudwatch.EventTargetArgs,
              "resource"
            )
          );

          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(identifier, "cloudwatch-perm"),
              "aws.lambda.Permission",
              {
                action: "lambda:InvokeFunction",
                //function: (lambda.resource as aws.lambda.Function).name,
                function: "${" + identifierBaseName + ".name}",
                principal: "events.amazonaws.com",
                sourceArn:
                  "${" + ResourceUtil.getBits(inputResource.name)[2] + ".arn}"
              } as aws.lambda.PermissionArgs,
              "resource"
            )
          );
          break;

        case "aws.s3.Bucket":
          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(identifier, "bucketnotification-perm"),
              "aws.lambda.Permission",
              {
                action: "lambda:InvokeFunction",
                function: "${" + identifierBaseName + ".arn}",
                principal: "s3.amazonaws.com",
                sourceArn:
                  "${" + ResourceUtil.getBits(inputResource.name)[2] + ".arn}"
              } as aws.lambda.PermissionArgs,
              "resource"
            )
          );

          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(identifier, "bucketnotification"),
              "aws.s3.BucketNotification",
              {
                bucket:
                  "${" + ResourceUtil.getBits(inputResource.name)[2] + ".id}",
                lambdaFunctions: [
                  {
                    events: ["s3:ObjectCreated:*"],
                    lambdaFunctionArn: "${" + identifierBaseName + ".arn}"
                  }
                ]
              } as aws.s3.BucketNotificationArgs,
              "resource"
            )
          );
          break;

        case "aws.apigateway.Resource":
          // create the pending bits for the api resource that link to the function
          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(identifier, "integration"),
              "aws.apigateway.Integration",
              {
                httpMethod: "${" + ResourceUtil.getBits(inputResource.name)[2] + "-method.httpMethod}",
                integrationHttpMethod: "POST",
                resourceId: "${" + ResourceUtil.getBits(inputResource.name)[2] + ".id}",
                restApi: "${apigw.id}",
                type: "AWS_PROXY",
                uri: "arn:aws:apigateway:${global:stack.region}:lambda:path/2015-03-31/functions/${" +
                  identifierBaseName +
                  ".arn}/invocations",
              } as unknown as aws.apigateway.IntegrationArgs,
              "resource",
            ),
          );

          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(identifier, "deployment"),
              "aws.apigateway.Deployment",
              {
                restApi: "${apigw.id}",
                stageName: this.environment
              } as unknown as aws.apigateway.DeploymentArgs,
              "resource",
              [identifierBaseName + "-integration"]
            )
          );

          resourceConfigs.push(
            this.resourceUtil.configure(
              ResourceUtil.injectInName(identifier, "gw-perm"),
              "aws.lambda.Permission",
              {
                action: "lambda:InvokeFunction",
                function: "${" + identifierBaseName + ".arn}",
                principal: "apigateway.amazonaws.com",
                sourceArn:
                  "arn:aws:execute-api:${global:stack.region}:${global:account.id}:${apigw.id}/" +
                  this.environment +
                  "/${" +
                  ResourceUtil.getBits(inputResource.name)[2] +
                  "-method.httpMethod}/${" +
                  ResourceUtil.getBits(inputResource.name)[2] +
                  ".pathPart}",
              } as aws.lambda.PermissionArgs,
              "resource"
            )
          );
          break;

        default:
          break;
      }
    }

    return [resources, resourceConfigs];
  }

  private async createRoutingComponent(
    name: string,
    mechanism: string | undefined,
    config: any
  ): Promise<ResourceConfig[]> {
    const awsConfig =
      (this.stackConfig.platform && this.stackConfig.platform.aws) || {};
    const defaultRoutingMechanism =
      awsConfig.defaultRoutingMechanism || "aws.kinesis.Stream";
    const defaultRoutingShards = awsConfig.defaultRoutingShards || 1;

    if (!mechanism) {
      mechanism = defaultRoutingMechanism;
    }

    if (!name) {
      throw new Error(
        `unable to get name for routing resource for component: '${name}'`
      );
    }

    // set some defauls depending on the routing mechanism
    if (mechanism === "aws.kinesis.Stream") {
      if (!config.shardCount) {
        config.shardCount = defaultRoutingShards; // TODO: allow shards to be set in config
      }
    } else if (mechanism === "aws.sqs.Queue") {
      if (!config.visibilityTimeoutSeconds) {
        config.visibilityTimeoutSeconds = 60;
      }
    } else if (mechanism === "aws.apigateway.Resource") {
      const apiGwName = `${this.stackConfig.name}-apigw-${this.environment}`;

      const resourceConfigs = [];

      // create the restapi if it does not exit
      resourceConfigs.push(this.resourceUtil.configure(apiGwName, "aws.apigateway.RestApi", {}, "resource"));

      // prepare config for the resource
      const newconfig = {
        parentId: "${apigw.rootResourceId}",
        pathPart: config.pathPart || "",
        restApi: "${apigw.id}",
      };

      // create the api resource
      resourceConfigs.push(this.resourceUtil.configure(name, mechanism, newconfig, "resource"));

      // create the api method
      resourceConfigs.push(this.resourceUtil.configure(
        ResourceUtil.injectInName(name, "method"),
        "aws.apigateway.Method",
        {
          apiKeyRequired: config.apiKeyRequired || false,
          authorization: config.authorization || "NONE",
          httpMethod: config.method,
          resourceId: "${" + ResourceUtil.getBits(name)[2] + ".id}",
          restApi: "${apigw.id}",
        } as unknown as aws.apigateway.MethodArgs,
        "resource",
      ));

      return resourceConfigs;
    }

    return [this.resourceUtil.configure(name, mechanism, config, "resource")];
  }

  private validate() {
    if (!this.flows) {
      throw new Error("flows must be set");
    }
    if (!this.stackConfig) {
      throw new Error("stackConfig must be set");
    }
    if (!this.environment) {
      throw new Error("environment must be set");
    }
    if (!this.buildBucket) {
      throw new Error("buildBucket must be set");
    }
  }
}
