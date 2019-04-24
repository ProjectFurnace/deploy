import * as gcp from "@pulumi/gcp"
import * as ResourceConfig from "./GcpResourceConfig.json";
import * as _ from "lodash";

export default class GcpResourceFactory {
  static getResource(name: string, type: string, config: any): [any, any] {
    return [ this.getResourceProvider(type), this.getResourceConfig(name, type, config) ];
  }

  private static getResourceProvider(type: string) {

    const providers: { [key: string]: any } = {
      "gcp.storage.Bucket": gcp.storage.Bucket
    }

    const provider = providers[type];
    if (!provider) throw new Error(`unknown resource type ${type}`);
    return provider;
  }

  private static getResourceConfig(name: string, type: string, config: any): any {
    const newConfig = _.cloneDeep(config);

    const nameProp = (ResourceConfig.nameProperties as { [key: string]: string })[type] || "name";
    newConfig[nameProp] = name;
    newConfig.name = name;

    return newConfig;
  }
}