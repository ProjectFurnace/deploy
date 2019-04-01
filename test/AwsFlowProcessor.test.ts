import AwsFlowProcessor from "../src/AwsFlowProcessor";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as mocks from "./mocks/pulumi";

describe('AwsFlowProcessor', () => {
  it('should work', async () => {
    mocks.stubCustomResource();

    const stack: Stack = {
      name: "test-stack",
      platform: {},
      state: {
        repo: "test"
      }
    }

    const spec: BuildSpec = {
      name: "",
      component: "",
      config: {},
      inputs: [],
      type: "",
      componentType: "",
      moduleSpec: {
        runtime: "nodejs8.10"
      },
      parameters: new Map<string, string>()
    }

    const p = new AwsFlowProcessor([spec], stack, "test", "testBucket");
    const resources = await p.process();

    resources.forEach(resource => expect(resource).toHaveProperty('__pulumiCustomResource'));

    console.log(resources);
  });
});