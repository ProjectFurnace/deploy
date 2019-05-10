import * as path from "path";
import ModuleBuilderBase from "../ModuleBuilderBase";
const {Storage} = require('@google-cloud/storage');

export default class GcpModuleBuilder extends ModuleBuilderBase {

  storage: any;

  constructor(repoDir: string, templateRepoDir: string, bucket: string, platform: string, initConfig: any) {
    super(repoDir, templateRepoDir, bucket, platform, initConfig);

    // Instantiate a storage client
    this.storage = new Storage();
  }

  async preProcess(def: any) {
    super.preProcess(def);
    
  }

  async postBuild(def: any) {
   
  }

  async uploadArtifcat(bucketName: string, key: string, artifact: string): Promise<any> {

    const artifactExists = await this.artifactExists(bucketName, key);

    if (artifactExists) {
      // console.log(`artifact with ${key} exists, skipping upload...`);
      return Promise.resolve();
    } else {
      return new Promise((resolve, reject) => {
        this.storage.bucket(bucketName).upload(artifact, {destination: key}, (error:any, file:any, result:any) => {
          if (error) reject(error)
          else resolve(result);
        });
      });
    }
  }

  async artifactExists(bucketName: string, key: string): Promise<boolean> {
    // check exists
    const [files] = await this.storage.bucket(bucketName).getFiles();
    if (files.indexOf(key) > -1) {
      return true;
    } else {
      return false;
    }
  }
}