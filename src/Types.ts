import * as pulumi from "@pulumi/pulumi";

// tslint:disable-next-line:interface-over-type-literal
export type ResourceConfig = {
  name: string,
  type: string,
  scope: string,
  options: any,
  outputs: any,
  propertiesWithVars: any[],
  config: any,
};

// tslint:disable-next-line:interface-over-type-literal
export type RegisteredResource = {
  name: string,
  type: string,
  resource: pulumi.CustomResource,
};
