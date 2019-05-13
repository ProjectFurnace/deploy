import * as gcp from "@pulumi/gcp"
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource, ResourceConfig } from "../Types";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import ModuleBuilderBase from "../ModuleBuilderBase";
import GcpResourceFactory from "./GcpResourceFactory";
import ResourceUtil from "../Util/ResourceUtil";
import awsUtil from "../Util/AwsUtil";

export default class GcpProcessor implements PlatformProcessor {

  cloudfunctionsService: gcp.projects.Service;
  resourceUtil: ResourceUtil;
  readonly PLATFORM: string = 'gcp';

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
    const { project } = this.initialConfig;

    // Create a function service. Is it better to do this from the CLI?
    const cloudfunctionsServiceConfig = this.resourceUtil.configure(`${stackName}FS`, "gcp.projects.Service", {
      project,
      service: "cloudfunctions.googleapis.com",
    }, 'resource');
    const cloudfunctionsServiceResource = this.resourceUtil.register(cloudfunctionsServiceConfig);
    resources.push(cloudfunctionsServiceResource);
    this.cloudfunctionsService = cloudfunctionsServiceResource.resource as gcp.projects.Service;

    return resources;
  }

  async process(): Promise<Array<RegisteredResource>> {


    const routingResources = ResourceUtil.flattenResourceArray(
      this.flows
        .filter(component => !["sink", "resource"].includes(component.component))
        .map(component => this.createRoutingComponent(component))
    );

    const resourceConfigs = this.flows
      .filter(flow => flow.componentType === "Resource" && flow.component !== "source")
      .map(flow => this.resourceUtil.configure(flow.meta!.identifier, flow.type!, flow.config, 'resource'));

    const nativeResourceConfigs = this.flows
      .filter(flow => flow.componentType === "NativeResource")
      .map(flow => this.createNativeResourceComponent(flow));

    for(const nativeResourceConfs of nativeResourceConfigs)
      resourceConfigs.push(...nativeResourceConfs);

    const resourceResources = this.resourceUtil.batchRegister(resourceConfigs);

    const moduleResources: RegisteredResource[] = [];
    const moduleComponents = this.flows.filter(flow => flow.componentType === "Module")

    for (const component of moduleComponents) {
      //TODO: this needs reviewing! sources is an array now
      /*const routingResource = routingResources.find(r => r.name === component.meta!.sources)
      if (!routingResource) throw new Error(`unable to find routing resource ${component.meta!.sources} in flow ${component.name}`);

      const resources = await this.createModuleResource(component, routingResource);
      resources.forEach(resource => moduleResources.push(resource));*/
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

  createRoutingComponent(component: BuildSpec): RegisteredResource[] {

    let name = this.getRoutingComponentName(component)
      , mechanism = "gcp.pubsub.Topic"
      , config: any = component && component.config && component.config.gcp || {}
      ;

    config = Object.assign({}, config, {});

    if (!name) throw new Error(`unable to get name for routing resource for component: '${component.name}'`);

    const pubSubTopicConfig = this.resourceUtil.configure(name, mechanism, config, 'resource');
    const pubSubTopicResource = this.resourceUtil.register(pubSubTopicConfig);
    const pubSubTopic = pubSubTopicResource.resource as gcp.pubsub.Topic;

    const pubSubSubscriptionConfig = this.resourceUtil.configure(`${name}-subscription`, "gcp.pubsub.Subscription", {
      ackDeadlineSeconds: 20,
      messageRetentionDuration: "1200s",
      retainAckedMessages: true,
      topic: pubSubTopic.name,
    }, 'resource');
    const pubSubSubscriptionResource = this.resourceUtil.register(pubSubSubscriptionConfig);

    return [
      pubSubTopicResource,
      pubSubSubscriptionResource
    ];
  }

  async createModuleResource(component: BuildSpec, inputResource: RegisteredResource) {
    const resources: RegisteredResource[] = [];

    await this.moduleBuilder!.initialize();
    const buildDef = await this.moduleBuilder!.processModule(component);

    const { identifier } = component.meta!;

    const objectName = `${component.module!}/${component.buildSpec!.hash}`;

    await this.moduleBuilder!.uploadArtifcat(this.buildBucket, objectName, buildDef.buildArtifact);

    const envVars: { [key: string]: string } = {
      STREAM_NAME: component.meta!.output!,
      STACK_NAME: this.stackConfig.name || "unknown",
      STACK_ENV: this.environment || "unknown",
      FURNACE_INSTANCE: process.env.FURNACE_INSTANCE || "unknown"
    };

    if (component.logging === "debug") envVars.DEBUG = '1';

    // Create an App Service Function
    const cloudFunctionConfig = this.resourceUtil.configure(identifier, 'gcp.cloudfunctions.Function', {
      availableMemoryMb: 128,
      description: identifier,
      entryPoint: 'process',
      runtime: 'nodejs8',
      sourceArchiveBucket: this.buildBucket,
      sourceArchiveObject: objectName,
      timeout: 60,
      environmentVariables: envVars,
      eventTrigger: {
        eventType: 'google.pubsub.topic.publish',
        resource: inputResource.name
      }
    } as gcp.cloudfunctions.FunctionArgs, 'resource', { options: {dependsOn: [this.cloudfunctionsService]}});

    resources.push(this.resourceUtil.register(cloudFunctionConfig));

    return resources;
  }

  createNativeResourceComponent(component: BuildSpec): ResourceConfig[] {
    const name = component.meta!.identifier
      , { type, config, componentType } = component
      ;

    const REGEX = /(\w+)-([\w_-]+)-(\w+)/;
    const name_bits = REGEX.exec(name);

    if( !name_bits) 
      throw new Error('Unable to destructure name while creating native resource');

    switch(type) {
      case "Table":
        const datasetConfig = {
          datasetId: `${name}_dataset`,
          location: gcp.config.region
        };
        const tableConfig = {
            datasetId: '${'+ name_bits[2] + '_dataset.datasetId}',
            schema: '[{"name": "' + config.primaryKey + '", "type": "' + config.primaryKeyType.toUpperCase() + '", "mode": "NULLABLE"}]',
            tableId: name,
            timePartitioning: {
                type: "DAY"
            }
        };
        const dataset = this.resourceUtil.configure(`${name_bits[1]}-${name_bits[2]}_dataset-${name_bits[3]}`, 'gcp.bigquery.Dataset', datasetConfig, 'resource', {}, {}, componentType);
        const table = this.resourceUtil.configure(name, 'gcp.bigquery.Table', tableConfig, 'resource', {}, {}, componentType);
        return [dataset, table];

      default:
        return [this.resourceUtil.configure(name, type!, config, 'resource', {}, {}, componentType)];
    }
  }

  getResource(config:ResourceConfig): [any, any] {
    const [provider, newConfig] = GcpResourceFactory.getResource(config.name, config.type, config.config);

    return [provider, newConfig];
  }

  processOutputs(name: string, resource: any, outputs: any) {}
}