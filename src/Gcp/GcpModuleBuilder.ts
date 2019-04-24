import * as path from "path";
import ModuleBuilderBase from "../ModuleBuilderBase";
import { execPromise } from "../Util/ProcessUtil";

export default class GcpModuleBuilder extends ModuleBuilderBase {

  constructor(repoDir: string, templateRepoDir: string, bucket: string, platform: string, initConfig: any) {
    super(repoDir, templateRepoDir, bucket, platform, initConfig);

  }

  async preProcess(def: any) {
    super.preProcess(def);
    
  }

  async postBuild(def: any) {
   
  }

  async uploadArtifcat(bucketName: string, key: string, artifact: string): Promise<any> {

    const artifactExists = await this.artifactExists(bucketName, key);

    if (artifactExists) {
      console.log(`artifact with ${key} exists, skipping upload...`);
      return Promise.resolve();
    } else {
      return new Promise((resolve, reject) => {
        // upload to bucket
      });
    }
  }

  async artifactExists(bucketName: string, key: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // check exists
    });
  }
}