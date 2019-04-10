import AzureModuleBuilder from "../../src/Azure/AzureModuleBuilder";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import * as md5file from "md5-file";

let builder: AzureModuleBuilder;

beforeEach(async () => {
    builder = new AzureModuleBuilder("test/fixtures/config", "test/fixtures/templates", "test-bucket", "azure");
    await builder.initialize();
});

describe.skip('processModule', () => {
  it('successfully processes module', async () => {

    const spec: BuildSpec = {
      name: 'pt',
      config: { },
      inputs: [],
      parameters: new Map<string, string>(),
      componentType: 'Module',
      component: 'pipeline-module',
      logging: undefined,
      policies: undefined,
      module: 'passthrough',
      meta:
      {
        source: 'test-stack-flowlogs-test',
        identifier: 'test-stack-pt-test',
        output: 'test-stack-pt-test-out'
      },
      moduleSpec: {
        runtime: "nodejs8.10"
      }
    }

    const buildDef = await builder.processModule(spec);

    const fileHash = md5file.sync(buildDef.buildArtifact);
    // expect(fileHash).toBe("026a23357bd37012f67dcc0daefbbbab");
    console.log("build output", buildDef);
    // builder.cleanup();
  });
});

describe('uploadArtifcat', () => {
  it.only('should successfully upload file to azure container', async () => {
    const result = await builder.uploadArtifcat("test", "test", "test/fixtures/config/azure/stack.yaml");
    console.log(result);
  });
});