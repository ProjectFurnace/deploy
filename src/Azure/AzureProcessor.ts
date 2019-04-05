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
      .filter(flow => !["sink", "resource"].includes(flow.component))
      .map(flow => this.createRoutingComponent(flow));

    const flatRoutingResources = [...([] as RegisteredResource[]).concat(...routingResources)]

    // const resourceResources = this.flows
    //   .filter(flow => flow.component === "resource")
    //   .map(flow => this.createResourceComponent(flow));

    const moduleResources = await this.flows
      .filter(flow => flow.componentType === "Module")
      .map(async flow => {
        const routingResource = flatRoutingResources.find(r => r.name === flow.meta!.source)
        if (!routingResource) throw new Error(`unable to find routing resource ${flow.meta!.source} in flow ${flow.name}`);
        return await this.createModuleResource(flow);
      });  

    return [
      // ...resources,
      ...([] as RegisteredResource[]).concat(...routingResources) // flatten the routingResources
    ];

  }

  createRoutingComponent(component: BuildSpec): RegisteredResource[] {

    let name = component.meta && component.meta!.output!
      , mechanism = "azure.eventhub.EventHub"
      , config: any = {}
      ;

    if (component.component === "source") {
      name = component.meta!.identifier;
      config = component.config.azure || {}
    }

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

  async createModuleResource(component: BuildSpec) {
    const resources: RegisteredResource[] = [];

    await this.moduleBuilder!.initialize();
    const buildDef = await this.moduleBuilder!.processModule(component);

    const { identifier } = component.meta!;

    // Zip the code in the repo and store on container
    const blobResource = this.register(`${identifier}-blob2`, "azure.storage.ZipBlob", {
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
        'WEBSITE_NODE_DEFAULT_VERSION': "8.11.1"
        // 'FUNCTIONS_EXTENSION_VERSION': ""
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

      const [resource, finalConfig] = AzureResourceFactory.getResource(name, type, config);
      const instance = new resource(name, finalConfig) as pulumi.CustomResource;

      return {
        name,
        type,
        resource: instance
      }
    } catch (err) {
      throw new Error(`unable to create resource ${name} of type ${type}: ${err}`);
    }
  }





  // Stream Analytics
  //
  // Create a dedicated Azure Resource Group for ARM
  // const armResourceGroup = new azure.core.ResourceGroup("armResourceGroup", {
  //   location: "WestUS",
  // });

  // Create an ARM template deployment using an ordinary JSON ARM template. This could be read from disk, of course.
  /*const armDeployment = new azure.core.TemplateDeployment("streamAnalytics", {
      resourceGroupName: armResourceGroup.name,
      templateBody: JSON.stringify({
          "$schema": "https://schema.management.azure.com/schemas/2015-01-01/deploymentTemplate.json#",
          "contentVersion": "1.0.0.0",
          "parameters": {
              "eventHubNamespaceName": {
                  "type": "string"
              },
              "eventHubName": {
                  "type": "string"
              },
              "eventHubAuthorizationRuleName": {
                  "type": "string"
              },
              "eventHubAuthorizationRuleKey": {
                  "type": "string"
              },
              "cosmosDBId": {
                  "type": "string"
              },
              "cosmosDBPrimaryMasterKey": {
                  "type": "string"
              },
          },
          "variables": {
              "location": "[resourceGroup().location]",
              "databaseName": databaseName,
              "collectionName": collectionName,
              "documentId": documentID
          },
          "resources": [
              {
                  "type": "Microsoft.StreamAnalytics/streamingjobs",
                  "name": "eh-to-db",
                  "apiVersion": "2016-03-01",
                  "location": "[variables('location')]",
                  "scale": null,
                  "properties": {
                      "sku": {
                          "name": "Standard"
                      },
                      "eventsOutOfOrderPolicy": "Adjust",
                      "outputErrorPolicy": "Stop",
                      "eventsOutOfOrderMaxDelayInSeconds": 0,
                      "eventsLateArrivalMaxDelayInSeconds": 5,
                      "dataLocale": "en-US",
                      "compatibilityLevel": "1.0"
                  },
                  "dependsOn": []
              },
              {
                  "type": "Microsoft.StreamAnalytics/streamingjobs/inputs",
                  "name": "eh-to-db/input-from-event-hub",
                  "apiVersion": "2016-03-01",
                  "scale": null,
                  "properties": {
                      "type": "Stream",
                      "datasource": {
                          "type": "Microsoft.ServiceBus/EventHub",
                          "properties": {
                              "eventHubName": "[parameters('eventHubName')]",
                              "serviceBusNamespace": "[parameters('eventHubNamespaceName')]",
                              "sharedAccessPolicyName": "[parameters('eventHubAuthorizationRuleName')]",
                              "sharedAccessPolicyKey": "[parameters('eventHubAuthorizationRuleKey')]",
                          }
                      },
                      "compression": {
                          "type": "None"
                      },
                      "serialization": {
                          "type": "Json",
                          "properties": {
                              "encoding": "UTF8"
                          }
                      },
                      "etag": "d35bfe5b-0fbb-4e29-9e4c-e34aa309c4e9"
                  },
                  "dependsOn": [
                      "[resourceId('Microsoft.StreamAnalytics/streamingjobs', 'eh-to-db')]"
                  ]
              },
              {
                  "type": "Microsoft.StreamAnalytics/streamingjobs/outputs",
                  "name": "eh-to-db/output-to-cosmosdb",
                  "apiVersion": "2016-03-01",
                  "scale": null,
                  "properties": {
                      "datasource": {
                          "type": "Microsoft.Storage/DocumentDB",
                          "properties": {
                              "accountId": "[parameters('cosmosDBId')]",
                              "accountKey": "[parameters('cosmosDBPrimaryMasterKey')]",
                              "database": "[variables('databaseName')]",
                              "collectionNamePattern": "[variables('collectionName')]",
                              "documentId": "[variables('documentId')]",
                          }
                      }
                  },
                  "dependsOn": [
                      "[resourceId('Microsoft.StreamAnalytics/streamingjobs', 'eh-to-db')]"
                  ]
              }
          ]
      }),
      parameters: {
          "cosmosDBId": cosmosDB.name,
          "cosmosDBPrimaryMasterKey": cosmosDB.primaryMasterKey,
          "eventHubName": eventHub3.name,
          "eventHubNamespaceName": eventHubNamespace.name,
          "eventHubAuthorizationRuleName": eventHubAuthorizationRule3.name,
          "eventHubAuthorizationRuleKey": eventHubAuthorizationRule3.primaryKey
      },
      deploymentMode: "Incremental",
  }, {dependsOn: [cosmosDB, eventHub3, eventHubNamespace, eventHubAuthorizationRule3, armResourceGroup]});
  */


  // }



  // CosmosDB
  //
  // Create a SQL-flavored instance of CosmosDB.
  /*const cosmosDB = new azure.cosmosdb.Account("cosmosDb", {
      kind: "GlobalDocumentDB",
      resourceGroupName: resourceGroup.name,
      location: resourceGroup.location,
      consistencyPolicy: {
          consistencyLevel: "BoundedStaleness",
          maxIntervalInSeconds: 10,
          maxStalenessPrefix: 200
      },
      offerType: "Standard",
      enableAutomaticFailover: false,
      geoLocations: [
          { location: resourceGroup.location, failoverPriority: 0 }
      ]
  });*/



}