import AwsProcessor from "./Aws/AwsProcessor";
import AwsModuleBuilder from "./Aws/AwsModuleBuilder";

import AzureProcessor from "./Azure/AzureProcessor";
import AzureModuleBuilder from "./Azure/AzureModuleBuilder";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { PlatformProcessor } from "./IPlatformProcessor";

import * as aws from "@pulumi/aws";

export default class PlatformProcessorFactory {
  static async getProcessor(platform: string, flows: Array<BuildSpec>, stack: Stack, environment: string, buildBucket: string, repoDir: string, templateRepoDir: string): Promise<PlatformProcessor>  {
    
    switch (platform) {
      case "aws":
        const identity = await aws.getCallerIdentity();
        const awsBuilder = new AwsModuleBuilder(repoDir, templateRepoDir, buildBucket, platform, this.getConfig(platform));
        return new AwsProcessor(flows, stack, environment, buildBucket, { identity }, awsBuilder);

      case "azure":
        const azureBuilder = new AzureModuleBuilder(repoDir, templateRepoDir, buildBucket, platform, this.getConfig(platform));
        return new AzureProcessor(flows, stack, environment, buildBucket, {}, azureBuilder);

      default:
        throw new Error(`unable to get platform processor for '${platform}'`)
    }
  }

  static getConfig(platform: string): any {
    switch (platform) {
      case "azure":
        return {
          storageConnectionString: process.env.STORAGE_CONNECTION_STRING
        }
      default:
        return {};
    }
  }
}
