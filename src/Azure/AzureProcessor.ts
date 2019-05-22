import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import * as azurestorage from "azure-storage";
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource, ResourceConfig } from "../Types";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import ModuleBuilderBase from "../ModuleBuilderBase";
import ResourceUtil from "../Util/ResourceUtil";
import AzureResourceFactory from "./AzureResourceFactory";
import * as _ from "lodash";
import AzureModuleBuilder from "./AzureModuleBuilder";
import Base64Util from "../Util/Base64Util";

export default class AzureProcessor implements PlatformProcessor {

  resourceGroup: azure.core.ResourceGroup;
  eventHubNamespace: azure.eventhub.EventHubNamespace;
  storageAccount: azure.storage.Account;
  storageContainer: azure.storage.Container;
  appservicePlan: azure.appservice.Plan;
  resourceUtil: ResourceUtil;

  constructor(private flows: Array<BuildSpec>, protected stackConfig: Stack, protected environment: string, private buildBucket: string, private initialConfig: any, private moduleBuilder: ModuleBuilderBase | null) {
    this.validate();
    this.resourceUtil = new ResourceUtil(this, this.stackConfig.name, this.environment);
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

    const resourceGroupConfig = this.resourceUtil.configure(`${stackName}-RG-${this.environment}`, "azure.core.ResourceGroup", { location: process.env.STACK_REGION }, 'resource');
    const resourceGroupResource = this.resourceUtil.register(resourceGroupConfig);
    resources.push(resourceGroupResource);
    this.resourceGroup = resourceGroupResource.resource as azure.core.ResourceGroup;

    const eventHubNamespaceConfig = this.resourceUtil.configure(`${stackName}-hubns-${this.environment}`, "azure.eventhub.EventHubNamespace", {
      capacity: 1,
      location: this.resourceGroup.location,
      resourceGroupName: this.resourceGroup.name,
      sku: 'Standard',
      tags: {
        environment: 'Production',
      },
    }, 'resource', {resourceGroup: this.resourceGroup});
    const eventHubNamespaceResource = this.resourceUtil.register(eventHubNamespaceConfig);
    //TODO: Should we push the event hub also here? Discuss with Danny
    //resources.push(instantiatedeventHubNamespace);
    this.eventHubNamespace = eventHubNamespaceResource.resource as azure.eventhub.EventHubNamespace;

    // create the storage account
    const storageAccountConfig = this.resourceUtil.configure(`${stackName}sa${this.environment}`, "azure.storage.Account", {
      resourceGroupName: this.resourceGroup.name,
      location: this.resourceGroup.location,
      accountKind: "StorageV2",
      accountTier: "Standard",
      accountReplicationType: "LRS"
    } as azure.storage.AccountArgs, 'resource', {resourceGroup: this.resourceGroup});
    const storageAccountResource = this.resourceUtil.register(storageAccountConfig);
    resources.push(storageAccountResource);
    this.storageAccount = storageAccountResource.resource as azure.storage.Account;

    // Create a storage container
    /*const storageContainerConfig = this.resourceUtil.configure(`${stackName}-sc-${this.environment}`, "azure.storage.Container", {
      resourceGroupName: this.resourceGroup.name,
      storageAccountName: this.storageAccount.name,
      containerAccessType: "private",
    }, 'resource', {resourceGroup: this.resourceGroup});
    const storageContainerResource = this.resourceUtil.register(storageContainerConfig);
    resources.push(storageContainerResource);
    this.storageContainer = storageContainerResource.resource as azure.storage.Container;*/

    // Create an App Service Plan
    const appServicePlanConfig = this.resourceUtil.configure(`${stackName}-Plan-${this.environment}`, "azure.appservice.Plan", {
      location: this.resourceGroup.location,
      resourceGroupName: this.resourceGroup.name,
      sku: {
        size: "S1",
        tier: "Standard",
      },
    }, 'resource', {resourceGroup: this.resourceGroup});
    const appServicePlanResource = this.resourceUtil.register(appServicePlanConfig);
    resources.push(appServicePlanResource);
    this.appservicePlan = appServicePlanResource.resource as azure.appservice.Plan;

    return resources;
  }

  async process(): Promise<Array<RegisteredResource>> {

    this.resourceUtil.setGlobal({
      stack: {
        name: this.stackConfig.name,
        region: this.resourceGroup.location,
        environment: this.environment
      },
      account: {
        subscriptionId: azure.config.subscriptionId
      }
    });
    

    /*const routingResources = ResourceUtil.flattenResourceArray(
      this.flows
        .filter(component => !["sink", "resource"].includes(component.component))
        .map(component => this.createRoutingComponent(component))
    );*/
    const routingDefs = this.getRoutingDefinitions();
    const routingResources = ResourceUtil.flattenResourceArray( routingDefs
      .map(def => this.createRoutingComponent(def.name, def.mechanism, def.config)));

    const resourceConfigs = this.flows
      .filter(flow => flow.componentType === "Resource" && flow.component !== "source")
      .map(flow => this.resourceUtil.configure(flow.meta!.identifier, flow.type!, flow.config, 'resource', {resourceGroup: this.resourceGroup}));

    const nativeResourceConfigs = this.flows
      .filter(flow => flow.componentType === "NativeResource")
      .map(flow => this.createNativeResourceComponent(flow));

    for(const nativeResourceConfs of nativeResourceConfigs)
      resourceConfigs.push(...nativeResourceConfs);

    const resourceResources = this.resourceUtil.batchRegister(resourceConfigs);

    const moduleResources: RegisteredResource[] = [];
    const moduleComponents = this.flows.filter(flow => flow.componentType === "Module")

    for (const component of moduleComponents) {
      //TODO: right now we only support one source for Azure
      if (component.meta!.sources!.length > 1) throw new Error(`Only one source is currently supported for Azure at: ${component.name}`);
      const inputResource = routingResources.find(r => r.name === component.meta!.sources![0] + "-rule");
      if (!inputResource) throw new Error(`unable to find EventHubAuthorizationRule for Input ${component.meta!.sources![0]} in flow ${component.name}`);
      const inputRule = inputResource.resource as azure.eventhub.EventHubAuthorizationRule;

      let outputRule = undefined;
      if (component.component !== 'sink') {
        const outputResource = routingResources.find(r => r.name === component.meta!.output + "-rule");
        if (!outputResource) throw new Error(`unable to find EventHubAuthorizationRule for Output ${component.meta!.output} in flow ${component.name}`);
        outputRule = outputResource.resource as azure.eventhub.EventHubAuthorizationRule;
      }

      const resources = await this.createModuleResource(component, inputRule, outputRule);
      resources.forEach(resource => moduleResources.push(resource));
    }

    return [
      ...resourceResources,
      ...moduleResources,
      ...routingResources
    ];

  }

  getRoutingComponentName(component: BuildSpec): string {
    if (component.component === "source") {
      return component.meta!.identifier;
    } else {
      return component.meta! && component.meta!.output!
    }
  }

  getRoutingDefinitions(): any[] {
    const routingDefs = [];
    
    const routingComponents = this.flows
      .filter(flow => ["source", "tap", "pipeline-module"].includes(flow.component));

    for (let component of routingComponents) {
      if (component.component === "source") {
        const existing = routingDefs.find(r => r.name === component.meta!.identifier);
        if (!existing) {
          routingDefs.push({
            name: component.meta!.identifier,
            mechanism: component.type,
            config: (component.config && component.config.aws) || {}
          });
        }
      } else {
        if (component.meta!.output) {
          const existing = routingDefs.find(r => r.name === component.meta!.output);
          if (!existing) {
            routingDefs.push({
              name: component.meta!.output!,
              mechanism: undefined,
              config: (component.config && component.config.aws) || {}
            });
          }
        }
        for (let source of component.meta!.sources!) {
          const existing = routingDefs.find(r => r.name === source);
          if (!existing) {
            routingDefs.push({
              name: source!,
              mechanism: undefined,
              config: (component.config && component.config.aws) || {}
            });
          }
        }
      }
    }
    return routingDefs;
  }

  createRoutingComponent(name: string, mechanism: string | undefined, config: any): RegisteredResource[] {
    const defaultRoutingMechanism = "azure.eventhub.EventHub";

    if (!mechanism) mechanism = defaultRoutingMechanism;
    if (!name) throw new Error(`unable to get name for routing resource for component: '${name}'`);

    config = Object.assign({}, config, {
      messageRetention: 1,
      namespaceName: this.eventHubNamespace.name,
      partitionCount: 2,
      resourceGroupName: this.resourceGroup.name,
    })

    if (!name) throw new Error(`unable to get name for routing resource for component: '${name}'`);

    const eventHubConfig = this.resourceUtil.configure(name, mechanism, config, 'resource', {resourceGroup: this.resourceGroup});
    const eventHubResource = this.resourceUtil.register(eventHubConfig);
    const eventHub = eventHubResource.resource as azure.eventhub.EventHub;

    const eventHubAuthorizationRuleConfig = this.resourceUtil.configure(`${name}-rule`, "azure.eventhub.EventHubAuthorizationRule", {
      eventhubName: eventHub.name,
      listen: true,
      manage: false,
      namespaceName: this.eventHubNamespace.name,
      resourceGroupName: this.resourceGroup.name,
      send: true,
    }, 'resource', {resourceGroup: this.resourceGroup});
    const eventHubAuthorizationRuleResource = this.resourceUtil.register(eventHubAuthorizationRuleConfig);

    return [
      eventHubResource,
      eventHubAuthorizationRuleResource
    ];

  }

  /*createRoutingComponent(component: BuildSpec): RegisteredResource[] {

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

    const eventHubConfig = this.resourceUtil.configure(name, mechanism, config, 'resource', {resourceGroup: this.resourceGroup});
    const eventHubResource = this.resourceUtil.register(eventHubConfig);
    const eventHub = eventHubResource.resource as azure.eventhub.EventHub;

    const eventHubAuthorizationRuleConfig = this.resourceUtil.configure(`${name}-rule`, "azure.eventhub.EventHubAuthorizationRule", {
      eventhubName: eventHub.name,
      listen: true,
      manage: false,
      namespaceName: this.eventHubNamespace.name,
      resourceGroupName: this.resourceGroup.name,
      send: true,
    }, 'resource', {resourceGroup: this.resourceGroup});
    const eventHubAuthorizationRuleResource = this.resourceUtil.register(eventHubAuthorizationRuleConfig);

    return [
      eventHubResource,
      eventHubAuthorizationRuleResource
    ];

  }*/

  async createModuleResource(component: BuildSpec, inputRule: azure.eventhub.EventHubAuthorizationRule, outputRule: azure.eventhub.EventHubAuthorizationRule | undefined) {
    const resources: RegisteredResource[] = [];

    await this.moduleBuilder!.initialize();
    const buildDef = await this.moduleBuilder!.processModule(component, true);

    const { identifier } = component.meta!;

    const blobName = `${component.module!}/${component.buildSpec!.hash}`
    await this.moduleBuilder!.uploadArtifcat(this.buildBucket, blobName, buildDef.buildArtifact)

    // // Zip the code in the repo and store on container
    // const blobResource = this.resourceUtil.register(blobName, "azure.storage.ZipBlob", {
    //   resourceGroupName: this.resourceGroup.name,
    //   storageAccountName: this.storageAccount.name,
    //   storageContainerName: this.storageContainer.name,
    //   type: "block",
    //   content: new pulumi.asset.FileArchive(buildDef.buildPath),

    // } as azure.storage.ZipBlobArgs);

    // resources.push(blobResource);
    // const blob = blobResource.resource as azure.storage.ZipBlob;

    // Generates an address for the function source
    //const codeBlobUrl = this.signedBlobReadUrl(blobName, this.storageAccount, this.storageContainer);
    const codeBlobUrl = this.signedBlobReadUrl(blobName, (this.moduleBuilder! as AzureModuleBuilder).connectionString, this.buildBucket);

    // Create App insights
    const functionAppAIConfig = this.resourceUtil.configure(`${this.stackConfig.name}-${component.name}-ai-${this.environment}`, "azure.appinsights.Insights", {
      applicationType: 'Web'
    } as azure.appinsights.InsightsArgs, 'module', {resourceGroup: this.resourceGroup});
    const functionAppAIResource = this.resourceUtil.register(functionAppAIConfig)
    resources.push(functionAppAIResource);

    const appSettings: any = {
      STACK_NAME: this.stackConfig.name || 'unknown',
      STACK_ENV: this.environment || 'unknown',
      FURNACE_INSTANCE: process.env.FURNACE_INSTANCE || 'unknown',
      FUNCTIONS_WORKER_RUNTIME: "node",
      WEBSITE_RUN_FROM_PACKAGE: codeBlobUrl,
      WEBSITE_NODE_DEFAULT_VERSION: '8.11.1',
      AZURE_STORAGE_CONNECTION_STRING: this.storageAccount.primaryConnectionString,
      inputEventHubConnectionAppSetting: inputRule.primaryConnectionString,
      APPINSIGHTS_INSTRUMENTATIONKEY: (functionAppAIResource.resource as azure.appinsights.Insights).instrumentationKey
    }

    if (component.logging === 'debug') appSettings['DEBUG'] = '1';

    for (let param of component.parameters) {
      appSettings[param[0].toUpperCase().replace(/'/g, '').replace(/-/g, '_')] = param[1]; 
    }

    if (outputRule)
      appSettings.outputEventHubConnectionAppSetting = outputRule!.primaryConnectionString;

    // Create an App Service Function
    const functionAppConfig = this.resourceUtil.configure(identifier, "azure.appservice.FunctionApp", {
      appServicePlanId: this.appservicePlan.id,
      location: this.resourceGroup.location,
      resourceGroupName: this.resourceGroup.name,
      enabled: true,
      storageConnectionString: (this.moduleBuilder! as AzureModuleBuilder).connectionString,   
      version: '~2',
      appSettings: appSettings,
      siteConfig: {
        alwaysOn: true
      }
    } as azure.appservice.FunctionAppArgs, 'module', {resourceGroup: this.resourceGroup});
    resources.push(this.resourceUtil.register(functionAppConfig));

    return resources;

  }

  // Given an Azure blob, create a SAS URL that can read it.
  signedBlobReadUrl(blobName: string, connectionString: string, container: string): string {
    // Choose a fixed, far-future expiration date for signed blob URLs.
    // The shared access signature (SAS) we generate for the Azure storage blob must remain valid for as long as the
    // Function App is deployed, since new instances will download the code on startup. By using a fixed date, rather
    // than (e.g.) "today plus ten years", the signing operation is idempotent.
    const signatureExpiration = new Date(2100, 1);

    let blobService = new azurestorage.BlobService(connectionString);
    let signature = blobService.generateSharedAccessSignature(
      container,
      blobName,
      {
        AccessPolicy: {
          Expiry: signatureExpiration,
          Permissions: azurestorage.BlobUtilities.SharedAccessPermissions.READ,
        },
      }
    );

    return blobService.getUrl(container, blobName, signature);
  }

  // Given an Azure blob, create a SAS URL that can read it.
/*  signedBlobReadUrl(
    blobName: string,
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
      container.name
    ]).apply(([connectionString, containerName]) => {
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

  }*/


createNativeResourceComponent(component: BuildSpec): ResourceConfig[] {
  const name = component.meta!.identifier
    , { type, config, componentType } = component
    ;

  switch(type) {
    case "Table":
      config.storageAccountName = this.storageAccount.name;
      const tableName = name.replace(/[^A-Za-z0-9]/g, '');
      return [this.resourceUtil.configure(`${tableName}`, 'azure.storage.Table', config, 'resource', {resourceGroup: this.resourceGroup}, {}, componentType)];

    case 'ActiveConnector':
      const { source, connection } = config.output;
      const output = {
        name: "azure-event-hubs",
        options: {
          connection: connection,
          eventHub: source
        }
      };

      const acConfig = {
        containers: [{
            name: name,
            image: 'projectfurnace/active-connector-azure:latest',
            memory: 0.5,
            cpu: 1,
            environmentVariables: {
              INPUT: Base64Util.toBase64(JSON.stringify(config.input)),
              OUTPUT: Base64Util.toBase64(JSON.stringify(output))
            }
        }],
        osType: 'Linux'
      };
      return [this.resourceUtil.configure(name, 'azure.containerservice.Group', acConfig, 'resource', {resourceGroup: this.resourceGroup}, {}, componentType)];

    default:
      return [this.resourceUtil.configure(name, type!, config, 'resource', {}, {}, componentType)];
  }
}

  getResource(config:ResourceConfig): [any, any] {

    const [provider, newConfig] = AzureResourceFactory.getResource(config.name, config.type, config.config);
    if (config.options.resourceGroup) {
      newConfig.resourceGroupName = config.options.resourceGroup.name;
      if (config.type != 'azure.eventhub.EventHubAuthorizationRule' && config.type != 'azure.eventhub.EventHub')
        newConfig.location = config.options.resourceGroup.location;
    }

    return [provider, newConfig];
  }

  processOutputs(name: string, resource: any, outputs: any) {}
}