import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import * as azurestorage from "azure-storage";
import * as fs from 'fs';
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource } from "../Types";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import AzureResourceFactory from "./AzureResourceFactory";
import ModuleBuilderBase from "../ModuleBuilderBase";

export default class AzureProcessor implements PlatformProcessor {

  resourceGroup: azure.core.ResourceGroup;
  eventHubNamespace: azure.eventhub.EventHubNamespace;
  storageAccount: azure.storage.Account;
  storageContainer: azure.storage.Container;
  appservicePlan: azure.appservice.Plan;

  constructor(private flows: Array<BuildSpec>, private stackConfig: Stack, private environment: string, private buildBucket: string, private initialConfig: any, private moduleBuilder: ModuleBuilderBase | null) {
    this.validate();
  }

  validate() {
    if (!this.flows) throw new Error("flows must be set");
    if (!this.stackConfig) throw new Error("stackConfig must be set");
    // const errors = AwsValidator.validate(config, flows);
    // if (errors.length > 0) throw new Error(JSON.stringify(errors));
  }

  async preProcess(): Promise<Array<RegisteredResource>> {

    const resources: RegisteredResource[] = [];
    const stackName = this.stackConfig.name;

    const resourceGroupResource = this.register(`${stackName}RG`, "azure.core.ResourceGroup", { location: "WestUS" })
    resources.push(resourceGroupResource);
    this.resourceGroup = resourceGroupResource.resource as azure.core.ResourceGroup;

    const eventHubNamespaceResource = this.register(`${stackName}NS`, "azure.eventhub.EventHubNamespace", {
      capacity: 1,
      location: this.resourceGroup.location,
      resourceGroupName: this.resourceGroup.name,
      sku: 'Standard',
      tags: {
        environment: 'Production',
      },
    });
    this.eventHubNamespace = eventHubNamespaceResource.resource as azure.eventhub.EventHubNamespace;

    // create the storage account
    const storageAccountResource = this.register(`${stackName}sa`, "azure.storage.Account", {
      resourceGroupName: this.resourceGroup.name,
      location: this.resourceGroup.location,
      accountKind: "StorageV2",
      accountTier: "Standard",
      accountReplicationType: "LRS",
    });
    resources.push(storageAccountResource);
    this.storageAccount = storageAccountResource.resource as azure.storage.Account;

    // Create a storage container
    const storageContainerResource = this.register(`${stackName}c`, "azure.storage.Container", {
      resourceGroupName: this.resourceGroup.name,
      storageAccountName: this.storageAccount.name,
      containerAccessType: "private",
    });
    resources.push(storageContainerResource);
    this.storageContainer = storageContainerResource.resource as azure.storage.Container;

    // Create an App Service Plan
    const appServicePlanResource = this.register(`${stackName}Plan`, "azure.appservice.Plan", {
      location: this.resourceGroup.location,
      resourceGroupName: this.resourceGroup.name,
      sku: {
        size: "S1",
        tier: "Standard",
      },
    });
    resources.push(appServicePlanResource);
    this.appservicePlan = appServicePlanResource.resource as azure.appservice.Plan;

    return resources;
  }

  async process(): Promise<Array<RegisteredResource>> {

    const routingResources = this.flows
      .filter(component => !["sink", "resource"].includes(component.component))
      .map(component => this.createRoutingComponent(component));

    const flatRoutingResources = [...([] as RegisteredResource[]).concat(...routingResources)]

    const resourceResources = this.flows
      .filter(component => component.component === "resource")
      .map(component => this.register(component.meta!.identifier, component.type!, component.config));

    const moduleResources = await this.flows
      .filter(flow => flow.componentType === "Module")
      .map(async flow => {
        
        const inputResource = flatRoutingResources.find(r => r.name === flow.meta!.source + "-rule");
        if (!inputResource) throw new Error(`unable to find EventHubAuthorizationRule for Input ${flow.meta!.source} in flow ${flow.name}`);

        const outputResource = flatRoutingResources.find(r => r.name === flow.meta!.output + "-rule");
        if (!outputResource) throw new Error(`unable to find EventHubAuthorizationRule for Outpul ${flow.meta!.output} in flow ${flow.name}`);

        const inputRule = inputResource.resource as azure.eventhub.EventHubAuthorizationRule;
        const outputRule = outputResource.resource as azure.eventhub.EventHubAuthorizationRule;

        return await this.createModuleResource(flow, inputRule, outputRule);
      });  

    return [
      // ...resources,
      ...([] as RegisteredResource[]).concat(...routingResources) // flatten the routingResources
    ];

  }

  getRoutingComponentName(component: BuildSpec): string {
    if (component.component === "source") {
      return component.meta!.identifier;
    } else {
      return component.meta! && component.meta!.output!
    }
  }

  createRoutingComponent(component: BuildSpec): RegisteredResource[] {

    let name = this.getRoutingComponentName(component)
      , mechanism = "azure.eventhub.EventHub"
      , config: any = component && component.config && component.config.azure || {}
      ;

    config = Object.assign({}, config, {
      messageRetention: 1,
      namespaceName: this.eventHubNamespace.name,
      partitionCount: 2,
      resourceGroupName: this.resourceGroup.name,
    })

    if (!name) throw new Error(`unable to get name for routing resource for component: '${component.name}'`);

    const eventHubResource = this.register(name, mechanism, config);
    const eventHub = eventHubResource.resource as azure.eventhub.EventHub;

    const eventHubAuthorizationRuleResource = this.register(`${name}-rule`, "azure.eventhub.EventHubAuthorizationRule", {
      eventhubName: eventHub.name,
      listen: true,
      manage: false,
      namespaceName: this.eventHubNamespace.name,
      resourceGroupName: this.resourceGroup.name,
      send: true,
    });

    return [
      eventHubResource,
      eventHubAuthorizationRuleResource
    ];

  }

  async createModuleResource(component: BuildSpec, inputRule: azure.eventhub.EventHubAuthorizationRule, outputRule: azure.eventhub.EventHubAuthorizationRule) {
    const resources: RegisteredResource[] = [];

    await this.moduleBuilder!.initialize();
    const buildDef = await this.moduleBuilder!.processModule(component);

    const { identifier } = component.meta!;

    // Zip the code in the repo and store on container
    const blobResource = this.register(`${identifier}-blob5`, "azure.storage.ZipBlob", {
      resourceGroupName: this.resourceGroup.name,
      storageAccountName: this.storageAccount.name,
      storageContainerName: this.storageContainer.name,
      type: "block",
      content: new pulumi.asset.FileArchive(buildDef.buildPath)
    } as azure.storage.ZipBlobArgs);

    resources.push(blobResource);
    const blob = blobResource.resource as azure.storage.ZipBlob;

    // Generates an address for the function source
    const codeBlobUrl = this.signedBlobReadUrl(blob, this.storageAccount, this.storageContainer);

    // Create an App Service Function
    resources.push(this.register(identifier, "azure.appservice.FunctionApp", {
      appServicePlanId: this.appservicePlan.id,
      location: this.resourceGroup.location,
      resourceGroupName: this.resourceGroup.name,
      enabled: true,
      storageConnectionString: this.storageAccount.primaryConnectionString,
      version: '~2',
      appSettings: {
        'FUNCTIONS_WORKER_RUNTIME': "node",
        'WEBSITE_RUN_FROM_PACKAGE': codeBlobUrl,
        'WEBSITE_NODE_DEFAULT_VERSION': "8.11.1",
        'inputEventHubConnectionAppSeting': inputRule.primaryConnectionString,
        'outputEventHubConnectionAppSeting': outputRule.primaryConnectionString
        // 'FUNCTIONS_EXTENSION_VERSION': ""
      },
      siteConfig: {
        alwaysOn: true
      }
    } as azure.appservice.FunctionAppArgs));

    return resources;

  }

  // Given an Azure blob, create a SAS URL that can read it.
  signedBlobReadUrl(
    blob: azure.storage.Blob | azure.storage.ZipBlob,
    account: azure.storage.Account,
    container: azure.storage.Container)
    : pulumi.Output<string> {
    // Choose a fixed, far-future expiration date for signed blob URLs.
    // The shared access signature (SAS) we generate for the Azure storage blob must remain valid for as long as the
    // Function App is deployed, since new instances will download the code on startup. By using a fixed date, rather
    // than (e.g.) "today plus ten years", the signing operation is idempotent.
    const signatureExpiration = new Date(2100, 1);

    return pulumi.all([
      account.primaryConnectionString,
      container.name,
      blob.name,
    ]).apply(([connectionString, containerName, blobName]) => {
      let blobService = new azurestorage.BlobService(connectionString);
      let signature = blobService.generateSharedAccessSignature(
        containerName,
        blobName,
        {
          AccessPolicy: {
            Expiry: signatureExpiration,
            Permissions: azurestorage.BlobUtilities.SharedAccessPermissions.READ,
          },
        }
      );

      return blobService.getUrl(containerName, blobName, signature);
    });

  }

  register(name: string, type: string, config: any): RegisteredResource {

    try {

      const [resource, newConfig] = AzureResourceFactory.getResource(name, type, config);

      if (this.resourceGroup) {
        newConfig.resourceGroupName = this.resourceGroup.name;
        newConfig.location = this.resourceGroup.location;
      }

      if (type === "azure.core.TemplateDeployment") {
        // console.log("azure.core.TemplateDeployment", config);
        // const t = JSON.parse(newConfig.templateBody);
        // console.log("templateBody", t);
      }

      const instance = new resource(name, newConfig) as pulumi.CustomResource;

      return {
        name,
        type,
        resource: instance
      }
    } catch (err) {
      throw new Error(`unable to create resource ${name} of type ${type}: ${err}`);
    }
  }
}