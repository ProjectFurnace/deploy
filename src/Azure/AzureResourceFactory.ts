import * as azure from "@pulumi/azure";
import * as AzureResourceConfig from "./AzureResourceConfig.json";
import * as _ from "lodash";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import { ResourceConfig } from "../Types";
import AzureProcessor from "./AzureProcessor";
import Base64Util from "../Util/Base64Util";

export default class AzureResourceFactory {
  public static getResourceProvider(type: string) {

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

  static getResourceConfig(component: BuildSpec, processor: AzureProcessor): ResourceConfig[] {
    const name = component.meta!.identifier;
    const { type, config } = component;
  
    switch(type) {
      case 'Table':
        config.storageAccountName = processor.storageAccount.name;
        config.location = processor.resourceGroup.location;
        config.resourceGroupName = processor.resourceGroup.name;
        const tableName = name.replace(/[^A-Za-z0-9]/g, '');
        return [processor.resourceUtil.configure(`${tableName}`, 'azure.storage.Table', config, 'resource')];
  
      case 'ActiveConnector':
        // if the output is passed as a var we need to get the resource name so we can still use vars on the yaml config
        const resourceName = (config.output.source.startsWith('${') ? config.output.source.substring(0, config.output.source.length - 6).substring(2) : config.output.source);
        const output = {
          name: "azure-event-hubs",
          options: {
            connection: '${' + resourceName + '-rule.primaryConnectionString}',
            eventHub: processor.resourceUtil.global.stack.name + '-' + resourceName + '-' + processor.resourceUtil.global.stack.environment
          }
        };
  
        const acConfig = {
          containers: [{
              name: name,
              image: 'projectfurnace/active-connectors:latest',
              memory: 1,
              cpu: 1,
              // TODO: we do not really want ports, but terraform does not allow to specify this bit without ports (while azure does)
              ports: [{
                port: 65534,
                protocol: "TCP",
              }],
              environmentVariables: {
                INPUT: Base64Util.toBase64(JSON.stringify(config.input)),
                OUTPUT: 'base64::' + JSON.stringify(output),
              }
          }],
          osType: 'Linux',
          resourceGroupName: processor.resourceGroup.name,
          location: processor.resourceGroup.location
        };
        return [processor.resourceUtil.configure(name, 'azure.containerservice.Group', acConfig, 'resource')];
  
      default:
        const nameProp = (AzureResourceConfig.nameProperties as { [key: string]: string })[type!] || "name";
        config.config[nameProp] = name;
        if (type != 'azure.eventhub.EventHubAuthorizationRule' && type != 'azure.eventhub.EventHub') {
          config.location = processor.resourceGroup.location;
          config.resourceGroupName = processor.resourceGroup.name;
        }

        return [processor.resourceUtil.configure(name, type!, config, 'resource')];
    }
  }
}