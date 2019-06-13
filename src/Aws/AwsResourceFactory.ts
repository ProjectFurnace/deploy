import * as gitUtils from "@project-furnace/gitutils";
import * as fsUtils from "@project-furnace/fsutils";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import * as AwsResourceConfig from "./AwsResourceConfig.json";
import * as _ from "lodash";
import Base64Util from "../Util/Base64Util";
import AwsProcessor from "./AwsProcessor";
import { BuildSpec } from "@project-furnace/stack-processor/dist/Model";
import { ResourceConfig } from "../Types";
import ResourceUtil from "../Util/ResourceUtil";
import DockerUtil from "../Util/DockerUtil";

export default class AwsResourceFactory {

  static getResource(name: string, type: string, config: any): [any, any] {
    return [ this.getResourceProvider(type), this.getResourceConfig(name, type, config) ];
  }

  private static getResourceProvider(type: string) {

    const providers: { [key: string]: any } = {
      "aws.elasticsearch.Domain": aws.elasticsearch.Domain,
      "aws.redshift.Cluster": aws.redshift.Cluster,
      "aws.kinesis.Stream": aws.kinesis.Stream,
      "aws.sqs.Queue": aws.sqs.Queue,
      "aws.iam.Role": aws.iam.Role,
      "aws.iam.RolePolicy": aws.iam.RolePolicy,
      "aws.iam.RolePolicyAttachment": aws.iam.RolePolicyAttachment,
      "aws.lambda.Function": aws.lambda.Function,
      "aws.lambda.EventSourceMapping": aws.lambda.EventSourceMapping,
      "awsx.apigateway.API": awsx.apigateway.API,
      "aws.ssm.Parameter": aws.ssm.Parameter,
      "awsx.ecs.FargateService": awsx.ecs.FargateService,
      "awsx.ecs.Cluster": awsx.ecs.Cluster,
      "awsx.ec2.Vpc": awsx.ec2.Vpc,
      "aws.kinesis.FirehoseDeliveryStream": aws.kinesis.FirehoseDeliveryStream,
      "aws.kinesis.AnalyticsApplication": aws.kinesis.AnalyticsApplication,
      "aws.dynamodb.Table": aws.dynamodb.Table
    }

    const provider = providers[type];
    if (!provider) throw new Error(`unknown resource type ${type}`);
    return provider;
  }

  private static getResourceConfig(name: string, type: string, config: any): any {
    const newConfig = _.cloneDeep(config);

    const nameProp = (AwsResourceConfig.nameProperties as { [key: string]: string })[type] || "name";
    newConfig[nameProp] = name;

    return newConfig;
  }

  static translateResourceConfig(type: string, config: any) {
    const newConfig = _.cloneDeep(config);

    switch (type) {
      default:
        return newConfig;
    }
  }
  
  static async getNativeResourceConfig(component: BuildSpec, processor: AwsProcessor) {
    const name = component.meta!.identifier
      , { type, config, componentType } = component
      ;

    switch(type) {
      case "Table":
        config.attributes = [{name: config.primaryKey, type: config.primaryKeyType.charAt(0).toUpperCase()}];
        config.hashKey = config.primaryKey;
        config.writeCapacity = 1;
        config.readCapacity = 1;
        delete config.primaryKey;
        delete config.primaryKeyType;
        return [processor.resourceUtil.configure(name, 'aws.dynamodb.Table', config, 'resource', {}, {}, componentType)];
  
      case 'ActiveConnector':
        // create a list of the credentials for the activeconnector
        const secrets = [];
        for( const item of config.input.options.credentials ) {
          secrets.push({
            name: (config.input.name + '_' + item).toUpperCase().replace(/-/g, '_'),
            // if we were doing params on different regions we'd need the full ARN
            // valueFrom: `arn:aws:ssm:${processor.resourceUtil.global.stack.region}:${processor.resourceUtil.global.account.id}:parameter/${process.env.FURNACE_INSTANCE}/${processor.resourceUtil.global.stack.name}-${item}-${processor.resourceUtil.global.stack.environment}`
            valueFrom: `/${process.env.FURNACE_INSTANCE}/activeconnector/${config.input.name}/${processor.resourceUtil.global.stack.name}-${item}-${processor.resourceUtil.global.stack.environment}`
          });
        }

        // create a specific role that allows access to parameter store for the credentials
        const functionRoleConfig = processor.resourceUtil.configure(ResourceUtil.injectInName(name, 'executionRole'), "aws.iam.Role", {
          assumeRolePolicy: JSON.stringify({
            "Version": "2012-10-17",
            "Statement": [
              {
                "Action": "sts:AssumeRole",
                "Principal": {
                  "Service": "ecs-tasks.amazonaws.com",
                },
                "Effect": "Allow",
                "Sid": "",
              },
            ],
          })
        }, 'resource');

        const functionRoleResource = processor.resourceUtil.register(functionRoleConfig);
        const role = (functionRoleResource.resource as aws.iam.Role);
    
        const rolePolicyDefStatement: aws.iam.PolicyStatement[] = [
          {
            Effect: "Allow",
            Action: ["ssm:GetParameters"],
            Resource: [`arn:aws:ssm:${aws.config.region}:${processor.resourceUtil.global.account.id}:parameter/${process.env.FURNACE_INSTANCE}/activeconnector/*`]
          }
        ];
    
        const rolePolicyDef: aws.iam.RolePolicyArgs = {
          role: role.id,
          policy: {
            Version: "2012-10-17",
            Statement: rolePolicyDefStatement
          }
        };
        
        const rolePolicyConf = processor.resourceUtil.configure(ResourceUtil.injectInName(name, 'policy'), "aws.iam.RolePolicy", rolePolicyDef, 'resource');
        processor.resourceUtil.register(rolePolicyConf);

        const rolePolicyAttachResourceConfig = processor.resourceUtil.configure(ResourceUtil.injectInName(name, 'AmazonECSTaskExecutionRolePolicy'), "aws.iam.RolePolicyAttachment", {
          role,
          policyArn: `arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`
        } as aws.iam.RolePolicyAttachmentArgs, 'resource');
        processor.resourceUtil.register(rolePolicyAttachResourceConfig);

        // build the container with the right connector
        //TODO: Validate config.input.name to avoid security issues
        const inputConnector = config.input.package || `@project-furnace/${config.input.name}-connector`;
        const outputConnector = config.output.package || `@project-furnace/aws-kinesis-stream-connector`;

        const dockerRepoUrl = `${processor.resourceUtil.global.account.id}.dkr.ecr.${aws.config.region}.amazonaws.com`;
        if (!pulumi.runtime.isDryRun()) {
          const dockerBuildPath = await fsUtils.createTempDirectory();

          await gitUtils.clone(dockerBuildPath, 'https://github.com/ProjectFurnace/active-connector-base', '', '');
          const dockerUtil = new DockerUtil(`activeconnector/${component.name}`, dockerBuildPath);
          await dockerUtil.getOrCreateRepo('aws');
          await dockerUtil.build(`--build-arg OUTPUT_CONNECTOR=${outputConnector} --build-arg INPUT_CONNECTOR=${inputConnector}`);
          await dockerUtil.push(`${processor.resourceUtil.global.account.id}.dkr.ecr.${aws.config.region}.amazonaws.com`);
        }

        const outputName = config.output.name || 'aws-kinesis-stream';
        const resourceName = (config.output.source.startsWith('${') ? config.output.source.substring(0, config.output.source.length - 6).substring(2) : config.output.source);
        const outputOptions = config.output.options || { stream: processor.resourceUtil.global.stack.name + '-' + resourceName + '-' + processor.resourceUtil.global.stack.environment };

        // remove credential list from the options so we do not encode those into the INPUT env var
        delete config.input.options.credentials;

        const fargateConfig = {
          name: ResourceUtil.injectInName(name, 'container'),
          cluster: '${' + component.name + '-cluster}',
          desiredCount: 1,
          taskDefinitionArgs: {
            executionRole: role,
            container: {
              image: `${processor.resourceUtil.global.account.id}.dkr.ecr.${aws.config.region}.amazonaws.com/activeconnector/${component.name}:latest`,
              memory: 512,
              secrets: secrets,
              environment: [
                { name: "INPUT_OPTIONS", value: Base64Util.toBase64(JSON.stringify(config.input.options)) },
                { name: "INPUT_NAME", value: config.input.name},
                { name: "INPUT_PACKAGE", value: inputConnector},
                { name: "OUTPUT_OPTIONS", value: Base64Util.toBase64(JSON.stringify(outputOptions)) },
                { name: "OUTPUT_NAME", value: outputName},
                { name: "OUTPUT_PACKAGE", value: outputConnector}
              ]    
            } as awsx.ecs.Container,
          },
          ...config
        } as unknown as awsx.ecs.FargateServiceArgs;

        const vpcConfig = {
          //name: ResourceUtil.injectInName(name, 'vpc'),
          subnets: [{
            type: 'private'
          }]
        } as awsx.ec2.VpcArgs;

        const clusterConfig = {
          name: ResourceUtil.injectInName(name, 'cluster'),
         // vpc: '${' + component.name + '-vpc}',
        } as unknown as awsx.ecs.ClusterArgs;

        //processor.resourceUtil.configure(ResourceUtil.injectInName(name, 'vpc'), 'awsx.ec2.Vpc', vpcConfig, 'resource', {}, {}, componentType)
        return [processor.resourceUtil.configure(ResourceUtil.injectInName(name, 'cluster'), 'awsx.ecs.Cluster', clusterConfig, 'resource', {}, {}, componentType),
                processor.resourceUtil.configure(ResourceUtil.injectInName(name, 'container'), 'awsx.ecs.FargateService', fargateConfig, 'resource', {}, {}, componentType)];

      default:
        return [processor.resourceUtil.configure(name, type!, config, 'resource', {}, {}, componentType)];
    }
  }
}