import * as aws from "@pulumi/aws";
import * as ResourceConfig from "./AwsResourceConfig.json";
import * as _ from "lodash";

export default class AwsResourceFactory {
  static getResource(name: string, type: string, config: any): [any, any] {
    return [ this.getResourceProvider(type), this.getResourceConfig(name, type, config) ];
  }

  private static getResourceProvider(type: string) {
    switch (type) {
      case "aws.elasticsearch.Domain": return aws.elasticsearch.Domain;
      case "aws.redshift.Cluster": return aws.redshift.Cluster;
      case "aws.kinesis.Stream": return aws.kinesis.Stream;
      case "aws.sqs.Queue": return aws.sqs.Queue;

      default: throw new Error(`unknown resource type ${type}`);
    }
  }

  private static getResourceConfig(name: string, type: string, config: any): any {
    const newConfig = _.cloneDeep(config);

    const nameProp = (ResourceConfig.nameProperties as { [key: string]: string })[type] || "name";
    newConfig[nameProp] = name;

    return newConfig;
  }

}