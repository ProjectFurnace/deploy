import * as azure from "@pulumi/azure";
import * as azurestorage from "azure-storage";
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource, ResourceConfig } from "../Types";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import FunctionBuilderBase from "../FunctionBuilderBase";
import ResourceUtil from "../Util/ResourceUtil";
import AzureResourceFactory from "./AzureResourceFactory";
import * as _ from "lodash";
import AzureFunctionBuilder from "./AzureFunctionBuilder";

export default class AzureProcessor implements PlatformProcessor {

  resourceGroup: azure.core.ResourceGroup;
  eventHubNamespace: azure.eventhub.EventHubNamespace;
  storageAccount: azure.storage.Account;
  storageContainer: azure.storage.Container;
  appservicePlan: azure.appservice.Plan;
  resourceUtil: ResourceUtil;
  readonly PLATFORM: string = 'azure';

  constructor(private flows: Array<BuildSpec>, protected stackConfig: Stack, protected environment: string, private buildBucket: string, private initialConfig: any, private functionBuilder: FunctionBuilderBase | null) {
    this.validate();
    this.resourceUtil = new ResourceUtil(this, this.stackConfig.name, this.environment);
  }

  validate() {
    if (!this.flows) throw new Error("flows must be set");
    if (!this.stackConfig) throw new Error("stackConfig must be set");
  }

  async preProcess(): Promise<Array<RegisteredResource>> {

    const resources: RegisteredResource[] = [];
    const stackName = this.stackConfig.name;

    const resourceGroupConfig = this.resourceUtil.configure(`${stackName}-rg-${this.environment}`, "azure.core.ResourceGroup", { location: process.env.STACK_REGION }, 'resource');
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
    const saName = `${stackName}sa${this.environment}`.replace(/[^A-Za-z0-9]/g, '');
    const storageAccountConfig = this.resourceUtil.configure(saName, "azure.storage.Account", {
      resourceGroupName: this.resourceGroup.name,
      location: this.resourceGroup.location,
      accountKind: "StorageV2",
      accountTier: "Standard",
      accountReplicationType: "LRS"
    } as azure.storage.AccountArgs, 'resource', {resourceGroup: this.resourceGroup});
    const storageAccountResource = this.resourceUtil.register(storageAccountConfig);
    resources.push(storageAccountResource);
    this.storageAccount = storageAccountResource.resource as azure.storage.Account;

    // Create an App Service Plan
    const appServicePlanConfig = this.resourceUtil.configure(`${stackName}-plan-${this.environment}`, "azure.appservice.Plan", {
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
    
    const routingDefs = ResourceUtil.getRoutingDefinitions(this.flows, this.PLATFORM);
    const routingResources = ResourceUtil.flattenResourceArray( routingDefs
      .map(def => this.createRoutingComponent(def.name, def.mechanism, def.config)));

    const resourceConfigs = this.flows
      .filter(flow => flow.componentType === "Resource" && flow.component !== "source")
      .map(flow => this.resourceUtil.configure(flow.meta!.identifier, flow.type!, flow.config, 'resource', {resourceGroup: this.resourceGroup}));

    const nativeResourceConfigs = this.flows
      .filter(flow => flow.componentType === "NativeResource")
      .map(flow => AzureResourceFactory.getNativeResourceConfig(flow, this));

    for(const nativeResourceConfs of nativeResourceConfigs)
      resourceConfigs.push(...nativeResourceConfs);

    const resourceResources = this.resourceUtil.batchRegister(resourceConfigs, routingResources);

    const functionResources: RegisteredResource[] = [];
    const functionComponents = this.flows.filter(flow => flow.componentType === "Function")

    for (const component of functionComponents) {
      //TODO: right now we only support one source for Azure
      if (component.meta!.sources!.length > 1) throw new Error(`Only one source is currently supported for Azure at: ${component.name}`);
      const inputResource = routingResources.find(r => r.name === ResourceUtil.injectInName(component.meta!.sources![0], 'rule'));
      if (!inputResource) throw new Error(`unable to find EventHubAuthorizationRule for Input ${component.meta!.sources![0]} in flow ${component.name}`);
      const inputRule = inputResource.resource as azure.eventhub.EventHubAuthorizationRule;

      let outputRule = undefined;
      if (component.component !== 'sink') {
        const outputResource = routingResources.find(r => r.name === ResourceUtil.injectInName(component.meta!.output!, 'rule'));
        if (!outputResource) throw new Error(`unable to find EventHubAuthorizationRule for Output ${component.meta!.output} in flow ${component.name}`);
        outputRule = outputResource.resource as azure.eventhub.EventHubAuthorizationRule;
      }

      const resources = await this.createFunctionResource(component, inputRule, outputRule);
      resources.forEach(resource => functionResources.push(resource));
    }

    return [
      ...resourceResources,
      ...functionResources,
      ...routingResources
    ];

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

    const eventHubAuthorizationRuleConfig = this.resourceUtil.configure(ResourceUtil.injectInName(name, 'rule'), "azure.eventhub.EventHubAuthorizationRule", {
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

  async createFunctionResource(component: BuildSpec, inputRule: azure.eventhub.EventHubAuthorizationRule, outputRule: azure.eventhub.EventHubAuthorizationRule | undefined) {
    const resources: RegisteredResource[] = [];

    await this.functionBuilder!.initialize();
    const buildDef = await this.functionBuilder!.processFunction(component, true);

    const { identifier } = component.meta!;

    const blobName = `${component.function!}/${component.buildSpec!.hash}`
    await this.functionBuilder!.uploadArtifcat(this.buildBucket, blobName, buildDef.buildArtifact)

    // generate code blob
    const codeBlobUrl = this.signedBlobReadUrl(blobName, (this.functionBuilder! as AzureFunctionBuilder).connectionString, this.buildBucket);

    // Create App insights
    const functionAppAIConfig = this.resourceUtil.configure(ResourceUtil.injectInName(identifier, 'ai'), "azure.appinsights.Insights", {
      applicationType: 'Web'
    } as azure.appinsights.InsightsArgs, 'function', {resourceGroup: this.resourceGroup});
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
      storageConnectionString: (this.functionBuilder! as AzureFunctionBuilder).connectionString,   
      version: '~2',
      appSettings: appSettings,
      siteConfig: {
        alwaysOn: true
      }
    } as azure.appservice.FunctionAppArgs, 'function', {resourceGroup: this.resourceGroup});
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