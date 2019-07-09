import FunctionBuilderBase from "../FunctionBuilderBase";
import * as s3Utils from "@project-furnace/s3utils";

export default class AwsFunctionBuilder extends FunctionBuilderBase {
  
  async uploadArtifcat(bucketName: string, key: string, artifact: string): Promise<any> {
    const artifactExists = await this.artifactExists(bucketName, key);

    if (artifactExists) {
      // console.log(`artifact with ${key} exists, skipping upload...`);
      return Promise.resolve();
    } else {
      return s3Utils.upload(bucketName, key, artifact); 
    }
  }  

  artifactExists(bucketName: string, key: string): Promise<boolean> {
    return s3Utils.objectExists(bucketName, key);
  }
}