import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import { RegisteredResource, ResourceConfig } from "./Types";
import FunctionBuilderBase from "./FunctionBuilderBase";
import * as pulumi from "@pulumi/pulumi";

export interface PlatformProcessorConstructor {
  new (flows: Array<BuildSpec>, stackConfig: Stack, environment: string, buildBucket: string, initialConfig: any, functionBuilder: FunctionBuilderBase | null): PlatformProcessor;
}

export interface PlatformProcessor {
  process(): Promise<Array<RegisteredResource>>
  preProcess(): Promise<Array<RegisteredResource>>
  //getResource(config:ResourceConfig): [any, any]
  getResource(config:ResourceConfig): any
  processOutputs(name:string, resource:any, outputs:any): void
}