import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import FunctionBuilderBase from "./FunctionBuilderBase";
import { RegisteredResource, ResourceConfig } from "./Types";

export interface PlatformProcessorConstructor {
  new (flows: Array<BuildSpec>, stackConfig: Stack, environment: string, buildBucket: string, initialConfig: any, functionBuilder: FunctionBuilderBase | null): PlatformProcessor;
}

export interface PlatformProcessor {
  process(): Promise<RegisteredResource[]>;
  preProcess(): Promise<RegisteredResource[]>;
  getResource(config: ResourceConfig): any;
  processOutputs(name: string, resource: any, outputs: any): void;
}
