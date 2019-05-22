import * as azure from "@pulumi/azure";
import * as ResourceConfig from "./AzureResourceConfig.json";
import * as _ from "lodash";

export default class AzureResourceFactory {
  static getResource(name: string, type: string, config: any): [any, any] {
    return [ this.getResourceProvider(type), this.getResourceConfig(name, type, config) ];
  }

  private static getResourceProvider(type: string) {

    const providers: { [key: string]: any } = {
      "azure.eventhub.EventHub": azure.eventhub.EventHub,
      "azure.eventhub.EventHubNamespace": azure.eventhub.EventHubNamespace,
      "azure.core.ResourceGroup": azure.core.ResourceGroup,
      "azure.storage.ZipBlob": azure.storage.ZipBlob,
      "azure.storage.Account": azure.storage.Account,
      "azure.storage.Container": azure.storage.Container,
      "azure.storage.Table": azure.storage.Table,
      "azure.appservice.FunctionApp": azure.appservice.FunctionApp,
      "azure.appservice.Plan": azure.appservice.Plan,
      "azure.appinsights.Insights": azure.appinsights.Insights,
      "azure.eventhub.EventHubAuthorizationRule": azure.eventhub.EventHubAuthorizationRule,
      "azure.cosmosdb.Account": azure.cosmosdb.Account,
      "azure.core.TemplateDeployment": azure.core.TemplateDeployment,
      "azure.containerservice.Group":  azure.containerservice.Group
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