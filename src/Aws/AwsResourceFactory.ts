import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as ResourceConfig from "./AwsResourceConfig.json";
import * as _ from "lodash";

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
      "aws.ssm.Parameter": aws.ssm.Parameter,
      "awsx.apigateway.API": awsx.apigateway.API
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
              nginx: {
                image: "nginx",
                memory: 512,
                environment: [
                  // { name: "", value: ""}
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
      case "awsx.apigateway.API":
        // for (let route of newConfig.routes) {
        //   if (!route.func) throw new Error(`func property must be set on route for resource type ${type}`);
        //   route.eventHandler = route.func;
        //   delete route.func;
        // }
        return newConfig;
      default:
        return newConfig;
    }
  }
}