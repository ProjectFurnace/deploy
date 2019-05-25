import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as AwsResourceConfig from "./AwsResourceConfig.json";
import * as _ from "lodash";
import Base64Util from "../Util/Base64Util";
import AwsProcessor from "./AwsProcessor";
import { BuildSpec } from "@project-furnace/stack-processor/dist/Model";
import { ResourceConfig } from "../Types";
import ResourceUtil from "../Util/ResourceUtil";

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
  
  static getNativeResourceConfig(component: BuildSpec, processor: AwsProcessor): ResourceConfig[] {
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
        const resourceName = (config.output.source.startsWith('${') ? config.output.source.substring(0, config.output.source.length - 6).substring(2) : config.output.source);
        const output = {
          name: "aws-kinesis-stream",
          options: {
            stream: processor.resourceUtil.global.stack.name + '-' + resourceName + '-' + processor.resourceUtil.global.stack.environment
          }
        }
  
        const fargateConfig = {
          name: ResourceUtil.injectInName(name, 'container'),
          cluster: '${' + component.name + '-cluster}',
          desiredCount: 1,
          taskDefinitionArgs: {
            container: {
              image: "projectfurnace/active-connectors:latest",
              memory: 512,
              environment: [
                { name: "INPUT", value: Base64Util.toBase64(JSON.stringify(config.input)) },
                { name: "OUTPUT", value: Base64Util.toBase64(JSON.stringify(output)) },
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