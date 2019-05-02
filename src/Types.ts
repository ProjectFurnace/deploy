import * as pulumi from "@pulumi/pulumi";

export type ResourceConfig = {
  name: string
  type: string
  scope: string
  options: any
  componentType: string
  propertiesWithVars: any[]
  config: any
}

export type RegisteredResource = {
  name: string
  type: string
  resource: pulumi.CustomResource
}