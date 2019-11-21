import AwsProcessor from "./Aws/AwsProcessor";
import AwsFunctionBuilder from "./Aws/AwsFunctionBuilder";

import AzureProcessor from "./Azure/AzureProcessor";
import AzureFunctionBuilder from "./Azure/AzureFunctionBuilder";

import GcpProcessor from "./Gcp/GcpProcessor";
import GcpFunctionBuilder from "./Gcp/GcpFunctionBuilder";

import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { PlatformProcessor } from "./IPlatformProcessor";

import * as aws from "@pulumi/aws";

export default class PlatformProcessorFactory {
  static async getProcessor(platform: string, flows: Array<BuildSpec>, stack: Stack, environment: string, buildBucket: string, stackRepoDir: string, templateRepoDir: string, reposCacheDir: string): Promise<PlatformProcessor>  {
    
    this.verifyEnvironment(platform);

    switch (platform) {
      case "aws":
        const identity = await aws.getCallerIdentity();
        const awsBuilder = new AwsFunctionBuilder(stackRepoDir, templateRepoDir, reposCacheDir, buildBucket, platform, this.getConfig(platform));
        return new AwsProcessor(flows, stack, environment, buildBucket, { identity }, awsBuilder);

      case "azure":
        const azureBuilder = new AzureFunctionBuilder(stackRepoDir, templateRepoDir, reposCacheDir, buildBucket, platform, this.getConfig(platform));
        return new AzureProcessor(flows, stack, environment, buildBucket, {}, azureBuilder);

      case "gcp":
        const gcpBuilder = new GcpFunctionBuilder(stackRepoDir, templateRepoDir, reposCacheDir, buildBucket, platform, this.getConfig(platform));
        return new GcpProcessor(flows, stack, environment, buildBucket, {}, gcpBuilder);

      default:
        throw new Error(`unable to get platform processor for '${platform}'`)
    }
  }

  static verifyEnvironment(platform: string) {

    let requiredVars: string[] = [];

    switch (platform) {
      case "aws":
        requiredVars = [];
        break;
      case "azure":
        requiredVars = [ "STORAGE_CONNECTION_STRING" ];
        break;
      case "gcp":
        requiredVars = [ "GCLOUD_PROJECT" ];
        break;
    }

    const passedVars = Object.keys(process.env);

    if (!requiredVars.every((v) => passedVars.includes(v))) {
      throw new Error(`you must provide ${requiredVars.join(',')} for platform ${platform}`);
    }

  }

  static getConfig(platform: string): any {
    switch (platform) {
      case "azure":
        return {
          storageConnectionString: process.env.STORAGE_CONNECTION_STRING,
        };
      case "gcp":
        return {
          project: process.env.GCP_PROJECT,
        };
      default:
        return {};
    }
  }
}
