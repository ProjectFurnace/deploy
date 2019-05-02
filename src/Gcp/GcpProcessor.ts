import * as gcp from "@pulumi/gcp"
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource } from "../Types";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import ModuleBuilderBase from "../ModuleBuilderBase";
import ResourceUtil from "../Util/ResourceUtil";

export default class GcpProcessor implements PlatformProcessor {

  cloudfunctionsService: gcp.projects.Service;
  resourceUtil: ResourceUtil;
  readonly PLATFORM: string = 'gcp';

  constructor(private flows: Array<BuildSpec>, private stackConfig: Stack, private environment: string, private buildBucket: string, private initialConfig: any, private moduleBuilder: ModuleBuilderBase | null) {
    this.validate();
    this.resourceUtil = new ResourceUtil(this.stackConfig.name, this.environment, this.PLATFORM);
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

    // Create a storage bucket
    /*const bucketResource = this.register(`${stackName}bucket`, "gcp.storage.Bucket", {});
    resources.push(bucketResource);
    this.bucket = bucketResource.resource as gcp.storage.Bucket;*/

    return resources;
  }

  async process(): Promise<Array<RegisteredResource>> {


    const routingResources = ResourceUtil.flattenResourceArray(
      this.flows
        .filter(component => !["sink", "resource"].includes(component.component))
        .map(component => this.createRoutingComponent(component))
    );

    const resourceConfigs = this.flows
    .filter(component => component.component === "resource")
    .map(component => this.resourceUtil.configure(component.meta!.identifier, component.type!, component.config, 'resource'));

    const resourceResources = this.resourceUtil.batchRegister(resourceConfigs);

    const moduleResources: RegisteredResource[] = [];
    const moduleComponents = this.flows.filter(flow => flow.componentType === "Module")

    for (const component of moduleComponents) {
      const routingResource = routingResources.find(r => r.name === component.meta!.source)
      if (!routingResource) throw new Error(`unable to find routing resource ${component.meta!.source} in flow ${component.name}`);

      const resources = await this.createModuleResource(component, routingResource);
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
}