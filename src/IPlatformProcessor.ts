import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { RegisteredResource } from "./Types";
import ModuleBuilderBase from "./ModuleBuilderBase";

export interface PlatformProcessorConstructor {
  new (flows: Array<BuildSpec>, stackConfig: Stack, environment: string, buildBucket: string, initialConfig: any, moduleBuilder: ModuleBuilderBase | null): PlatformProcessor;
}

export interface PlatformProcessor {
  process(): Promise<Array<RegisteredResource>>
  preProcess(): Promise<Array<RegisteredResource>>
}