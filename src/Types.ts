import * as pulumi from "@pulumi/pulumi";

export type RegisteredResource = {
  name: string
  type: string
  resource: pulumi.CustomResource
}