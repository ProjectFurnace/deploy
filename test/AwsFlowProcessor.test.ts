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
      name: 'flowlogs-tap',
      config: { aws: { shards: 1 } },
      inputs: [],
      parameters: new Map<string,string>(),
      componentType: 'Module',
      component: 'tap',
      logging: undefined,
      policies: undefined,
      module: 'aws-vpcfl',
      meta:
      { source: 'test-stack-flowlogs-test',
        identifier: 'test-stack-flowlogs-tap-test',
        output: 'test-stack-flowlogs-tap-test-out'
      },
      moduleSpec: {
        runtime: "nodejs8.10"
      }
  }

    const p = new AwsFlowProcessor([spec], stack, "test", "testBucket");
    
    const identity: aws.GetCallerIdentityResult = {
      accountId: "accountId",
      arn: "arn",
      id: "id",
      userId: "userId"
    }

    const resources = await p.process(identity);

    resources.forEach(resource => expect(resource).toHaveProperty('__pulumiCustomResource'));

    console.log(resources);
  });
});