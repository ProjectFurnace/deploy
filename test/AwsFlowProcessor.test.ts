import AwsFlowProcessor from "../src/AwsFlowProcessor";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

describe('AwsFlowProcessor', () => {
  it('should work', async () => {

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
      moduleSpec: {
        runtime: "nodejs8.10"
      },
      parameters: new Map<string, string>()
    }

    const p = new AwsFlowProcessor([spec], stack, "test", "testBucket");
    const resources = await p.process();
    console.log(resources);
  });
});