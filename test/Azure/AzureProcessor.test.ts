import AzureProcessor from "../../src/Azure/AzureProcessor";
import AzureModuleBuilder from "../../src/Azure/AzureModuleBuilder";
import { BuildSpec, Stack } from "@project-furnace/stack-processor/src/Model";
import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import * as mocks from "../mocks/pulumi";
import { RegisteredResource } from "../../src/Types";

beforeAll(() => {
  mocks.stubCustomResource();
});

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
  parameters: new Map<string, string>(),
  componentType: 'Module',
  component: 'tap',
  logging: undefined,
  policies: undefined,
  module: 'aws-vpcfl',
  meta:
  {
    source: 'test-stack-flowlogs-test',
    identifier: 'test-stack-flowlogs-tap-test',
    output: 'test-stack-flowlogs-tap-test-out'
  },
  moduleSpec: {
    runtime: "nodejs8.10"
  }
}

describe('AzureProcessor', () => {
  it('createRoutingComponent', async () => {

    const p = new AzureProcessor([spec], stack, "test", "testBucket", {}, null);
    await p.preProcess();
    const resources = await p.process();

    expect(resources.length).toBe(2);

  });

  describe.skip('preProcess', () => {
    it('should return correct initial resources', async () => {

      const p = new AzureProcessor([], stack, "test", "testBucket", {}, null);
      const resources = await p.preProcess();

      expect(Array.isArray(resources)).toBeTruthy();
      const nameTypes = resources.map(resource => ({
        name: resource.name,
        type: resource.type
      }));

      const expectedNameTypes = [ 
        { name: 'test-stack-rg', type: 'azure.core.ResourceGroup' },
        { name: 'test-stack-sa', type: 'azure.storage.Account' },
        { name: 'test-stack-c', type: 'azure.storage.Container' },
        { name: 'test-stack-plan', type: 'azure.appservice.Plan' }
      ];

      expect(nameTypes).toMatchObject(expectedNameTypes);

    });
  })

  describe('createRoutingComponent', () => {
    it('should return correct resources', async () => {

      const builder = new AzureModuleBuilder("test/fixtures/config", "test/fixtures/templates", "test-bucket", "azure");
      const p = new AzureProcessor([], stack, "test", "testBucket", {}, builder);
      
      await p.preProcess();

      const resources = await p.createRoutingComponent(spec);
      expect(resources).toHaveLength(2);

    });
  })

  describe('createModuleResource', () => {
    it.skip('should return correct resources', async () => {

      const builder = new AzureModuleBuilder("test/fixtures/config", "test/fixtures/templates", "test-bucket", "azure");
      const p = new AzureProcessor([], stack, "test", "testBucket", {}, builder);
      
      await p.preProcess();

      // const resources = await p.createModuleResource(spec);
      // expect(resources).toHaveLength(2);

    });
  })

});