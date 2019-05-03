import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { RegisteredResource, ResourceConfig } from "./Types";
import ModuleBuilderBase from "./ModuleBuilderBase";
import * as pulumi from "@pulumi/pulumi";

export interface PlatformProcessorConstructor {
  new (flows: Array<BuildSpec>, stackConfig: Stack, environment: string, buildBucket: string, initialConfig: any, moduleBuilder: ModuleBuilderBase | null): PlatformProcessor;
}

export interface PlatformProcessor {
  process(): Promise<Array<RegisteredResource>>
  preProcess(): Promise<Array<RegisteredResource>>
  getResource(config:ResourceConfig): [any, any]
  getStackName(): string
  getEnvironment(): string
  processOutputs(name:string, resource:any, outputs:any): void
}