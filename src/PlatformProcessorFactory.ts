import AwsProcessor from "./AwsProcessor";
import AwsModuleBuilder from "./AwsModuleBuilder";

import AzureProcessor from "./AzureProcessor";
import AzureModuleBuilder from "./AzureModuleBuilder";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { PlatformProcessor } from "./IPlatformProcessor";

import * as aws from "@pulumi/aws";

export default class PlatformProcessorFactory {
  static async getProcessor(platform: string, flows: Array<BuildSpec>, stack: Stack, environment: string, buildBucket: string, repoDir: string, templateRepoDir: string): Promise<PlatformProcessor>  {
    
    switch (platform) {
      case "aws":
        const identity = await aws.getCallerIdentity();
        const awsBuilder = new AwsModuleBuilder(repoDir, templateRepoDir, buildBucket, platform);
        return new AwsProcessor(flows, stack, environment, buildBucket, { identity }, awsBuilder);

      case "azure":
        const azureBuilder = new AzureModuleBuilder(repoDir, templateRepoDir, buildBucket, platform);
        return new AzureProcessor(flows, stack, environment, buildBucket, {}, azureBuilder);

      default:
        throw new Error(`unable to get platform processor for '${platform}'`)
    }
  }
}
