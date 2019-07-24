import * as gcp from "@pulumi/gcp"
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource, ResourceConfig } from "../Types";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import FunctionBuilderBase from "../FunctionBuilderBase";
import GcpResourceFactory from "./GcpResourceFactory";
import ResourceUtil from "../Util/ResourceUtil";
import Base64Util from "../Util/Base64Util";
import { environment } from "@pulumi/azure/config";

export default class GcpProcessor implements PlatformProcessor {

  cloudfunctionsService: gcp.projects.Service;
  resourceUtil: ResourceUtil;
  readonly PLATFORM: string = 'gcp';

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
    const { project } = this.initialConfig;

    // Create a function service. Is it better to do this from the CLI?
    const cloudfunctionsServiceConfig = this.resourceUtil.configure(`${stackName}-fs-${this.environment}`, "gcp.projects.Service", {
      project,
      service: "cloudfunctions.googleapis.com",
    }, 'resource');
    const cloudfunctionsServiceResource = this.resourceUtil.register(cloudfunctionsServiceConfig);
    resources.push(cloudfunctionsServiceResource);
    this.cloudfunctionsService = cloudfunctionsServiceResource.resource as gcp.projects.Service;

    return resources;
  }

  async process(): Promise<Array<RegisteredResource>> {

    this.resourceUtil.setGlobal({
      stack: {
        name: this.stackConfig.name,
        region: gcp.config.region,
        environment: this.environment
      },
      account: {
        project: gcp.config.project
      }
    });

    const routingDefs = ResourceUtil.getRoutingDefinitions(this.flows, this.PLATFORM);

    const routingResources = ResourceUtil.flattenResourceArray( routingDefs
      .map(def => this.createRoutingComponent(def.name, def.mechanism, def.config)));

    const nestedResourceConfigs = this.flows
      .filter(flow => ['resource', 'connector'].includes(flow.construct))
      .map(flow => GcpResourceFactory.getResourceConfig(flow, this));

    const resourceConfigs = []

    for(const nestedResourceConfs of nestedResourceConfigs)
      resourceConfigs.push(...nestedResourceConfs);

    const resourceResources = this.resourceUtil.batchRegister(resourceConfigs, routingResources);

    const functionResources: RegisteredResource[] = [];
    const functionComponents = this.flows.filter(flow => flow.functionSpec)

    for (const component of functionComponents) {
      //TODO: right now we only support one source for GCP
      if (component.meta!.sources!.length > 1) throw new Error(`Only one source is currently supported for GCP at: ${component.name}`);
      const routingResource = routingResources.find(r => r.name === component.meta!.sources![0])
      if (!routingResource) throw new Error(`unable to find routing resource ${component.meta!.sources![0]} in flow ${component.name}`);

      const resources = await this.createFunctionResource(component, routingResource);
      resources.forEach(resource => functionResources.push(resource));
    }

    return [
      ...resourceResources,
      ...functionResources,
      ...routingResources
    ];

  }

  createRoutingComponent(name: string, mechanism: string | undefined, config: any): RegisteredResource[] {
    const defaultRoutingMechanism = 'gcp.pubsub.Topic';

    if (!mechanism) mechanism = defaultRoutingMechanism;
    if (!name) throw new Error(`unable to get name for routing resource for component: '${name}'`);

    config = Object.assign({}, config, {});

    if (!name) throw new Error(`unable to get name for routing resource for component: '${name}'`);

    const pubSubTopicConfig = this.resourceUtil.configure(name, mechanism, config, 'resource');
    const pubSubTopicResource = this.resourceUtil.register(pubSubTopicConfig);
    const pubSubTopic = pubSubTopicResource.resource as gcp.pubsub.Topic;

    const pubSubSubscriptionConfig = this.resourceUtil.configure(ResourceUtil.injectInName(name, 'subscription'), "gcp.pubsub.Subscription", {
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

  async createFunctionResource(component: BuildSpec, inputResource: RegisteredResource) {
    const resources: RegisteredResource[] = [];

    await this.functionBuilder!.initialize();
    const buildDef = await this.functionBuilder!.processFunction(component);

    const { identifier } = component.meta!;

    const objectName = `${component.functionSpec.functions[0].name!}/${component.buildSpec!.hash}`;

    await this.functionBuilder!.uploadArtifcat(this.buildBucket, objectName, buildDef.buildArtifact);

    const envVars: { [key: string]: string } = {
      STREAM_NAME: component.meta!.output!,
      STACK_NAME: this.stackConfig.name || "unknown",
      STACK_ENV: this.environment || "unknown",
      FURNACE_INSTANCE: process.env.FURNACE_INSTANCE || "unknown"
    };

    for (let param of component.functionSpec.functions[0].parameters) {
      envVars[param[0].toUpperCase().replace(/'/g, '').replace(/-/g, '_')] = param[1]; 
    }

    // we have a combined function
    if (component.functionSpec.functions.length > 1) {
      envVars['COMBINE'] = '';

      for( const func of component.functionSpec.functions) {
        envVars['COMBINE'] = envVars['COMBINE'].concat(func.function, ',');
      }
      // remove last comma - there's probably a fancier way to do this...
      envVars['COMBINE'] = envVars['COMBINE'].substring(0, envVars['COMBINE'].length - 1);
    }

    if (component.logging === "debug") envVars.DEBUG = '1';

    let runtime = 'nodejs8'
    if (component.functionSpec.runtime == 'python3.6')
      runtime = 'python37'

    // Create an App Service Function
    const cloudFunctionConfig = this.resourceUtil.configure(identifier, 'gcp.cloudfunctions.Function', {
      availableMemoryMb: 128,
      description: identifier,
      entryPoint: 'process',
      runtime: runtime,
      sourceArchiveBucket: this.buildBucket,
      sourceArchiveObject: objectName,
      timeout: 60,
      environmentVariables: envVars,
      eventTrigger: {
        eventType: 'google.pubsub.topic.publish',
        resource: inputResource.name
      }
    } as gcp.cloudfunctions.FunctionArgs, 'resource', { dependsOn: [this.cloudfunctionsService]});

    resources.push(this.resourceUtil.register(cloudFunctionConfig));

    return resources;
  }

  getResource(config:ResourceConfig): any {
    return GcpResourceFactory.getResourceProvider(config.type);
  }

  processOutputs(name: string, resource: any, outputs: any) {}
}