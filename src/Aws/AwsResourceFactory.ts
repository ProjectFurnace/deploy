import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as ResourceConfig from "./AwsResourceConfig.json";
import * as _ from "lodash";
import Base64Util from "../Util/Base64Util";

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
      "aws.lambda.Function": aws.lambda.Function,
      "aws.lambda.EventSourceMapping": aws.lambda.EventSourceMapping,
      "awsx.apigateway.API": awsx.apigateway.API,
      "aws.ssm.Parameter": aws.ssm.Parameter
    }

    const provider = providers[type];
    if (!provider) throw new Error(`unknown resource type ${type}`);
    return provider;
  }

  private static getResourceConfig(name: string, type: string, config: any): any {
    const newConfig = _.cloneDeep(config);

    const nameProp = (ResourceConfig.nameProperties as { [key: string]: string })[type] || "name";
    newConfig[nameProp] = name;

    return newConfig;
  }

  static getNativeResource(name: string, type: string, config: any): [any, any] {

    let finalConfig = this.getResourceConfig(name, type, config);

    switch (type) {
      case "ActiveConnector":
        return [ awsx.ecs.FargateService, {
          desiredCount: 1,
          taskDefinitionArgs: {
            containers: {
              [name]: {
                image: "dannywaite/active-connectors:latest",
                memory: 512,
                environment: [
                  { name: "INPUT", value: Base64Util.toBase64(JSON.stringify(config.input)) },
                  { name: "OUTPUT", value: Base64Util.toBase64(JSON.stringify(config.output)) },
                ]    
              } as awsx.ecs.Container,
            },
          },
          ...finalConfig
        } as awsx.ecs.FargateServiceArgs ];
      default:
        throw new Error(`unable native resource type ${type}`);
    }
  }

  static translateResourceConfig(type: string, config: any) {
    const newConfig = _.cloneDeep(config);

    switch (type) {
      default:
        return newConfig;
    }
  }
}