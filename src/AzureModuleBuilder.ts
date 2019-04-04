import * as fsUtils from "@project-furnace/fsutils";
import * as path from "path";
import ModuleBuilderBase from "./ModuleBuilderBase";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";

export default class AzureModuleBuilder extends ModuleBuilderBase {

  async prepareModule(buildSpec: BuildSpec, templatePath: string, moduleBuildPath: string, codePath: string) {
    super.prepareModule(buildSpec, templatePath, moduleBuildPath, codePath);

    const functionDefPath = path.join(moduleBuildPath, "function.json")
        , { identifier, source, output } = buildSpec.meta!;
        ;

    if (!fsUtils.exists(functionDefPath)) throw new Error(`cannot find function.json for module ${identifier}`);

    const rawdata = fsUtils.readFile(functionDefPath)
      , functionJson = JSON.parse(rawdata)
      ;

    const bindings = [
      {
        authLevel: 'anonymous',
        type: 'eventHubTrigger',
        direction: 'in',
        name: `${source}-msg`,
        eventHubName: source,
        connection: 'inputEventHubConnectionAppSeting'
      },
      {
        type: 'eventHub',
        direction: 'out',
        name: `${output}-msg`,
        eventHubName: output,
        connection: 'outputEventHubConnectionAppSeting'
      }
    ]

    functionJson.bindings = bindings;
    fsUtils.writeFile(functionDefPath, JSON.stringify(functionJson));
  }

  uploadArtifcat(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}