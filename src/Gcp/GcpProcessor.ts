import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import { PlatformProcessor } from "../IPlatformProcessor";
import { RegisteredResource } from "../Types";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import AzureResourceFactory from "./GcpResourceFactory";
import ModuleBuilderBase from "../ModuleBuilderBase";

export default class GcpProcessor implements PlatformProcessor {

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
    return [];
  }

  async process(): Promise<Array<RegisteredResource>> {

    const routingResources = this.flattenResourceArray(
      this.flows
        .filter(component => !["sink", "resource"].includes(component.component))
        .map(component => this.createRoutingComponent(component))
    );

    const resourceResources = this.flows
      .filter(component => component.component === "resource")
      .map(component => this.register(component.meta!.identifier, component.type!, component.config));

    const moduleResources: RegisteredResource[] = [];
    const moduleComponents = this.flows.filter(flow => flow.componentType === "Module")

    return [
      ...resourceResources,
      ...moduleResources,
      ...routingResources
    ];

  }

  flattenResourceArray(resources: RegisteredResource[][]): RegisteredResource[] {
    return [...([] as RegisteredResource[]).concat(...resources)];
  }

  getRoutingComponentName(component: BuildSpec): string {
    if (component.component === "source") {
      return component.meta!.identifier;
    } else {
      return component.meta! && component.meta!.output!
    }
  }

  createRoutingComponent(component: BuildSpec): RegisteredResource[] {
    return []
  }

  async createModuleResource(component: BuildSpec) {
    const resources: RegisteredResource[] = [];

    await this.moduleBuilder!.initialize();
    const buildDef = await this.moduleBuilder!.processModule(component);

    const { identifier } = component.meta!;

    return resources;

  }

  register(name: string, type: string, config: any): RegisteredResource {

    try {

      const [resource, newConfig] = AzureResourceFactory.getResource(name, type, config);

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