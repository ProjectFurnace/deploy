import * as fsUtils from "@project-furnace/fsutils";
import * as fs from "fs-extra";
import * as path from "path";
import ModuleBuilderBase from "../ModuleBuilderBase";
import { execPromise } from "../Util/ProcessUtil";

export default class AzureModuleBuilder extends ModuleBuilderBase {

  async preProcess(def: any) {
    super.preProcess(def);

    const functionDefPath = path.join(def.buildPath, "function.json")
        , { identifier, source, output } = def;
        ;

    if (!fsUtils.exists(functionDefPath)) throw new Error(`cannot find function.json for module ${identifier}`);

    const rawdata = fsUtils.readFile(functionDefPath)
      , functionJson = JSON.parse(rawdata)
      ;

    const bindings = [
      {
        type: 'eventHubTrigger',
        direction: 'in',
        name:'eventInput',
        eventHubName: source,
        connection: 'inputEventHubConnectionAppSeting'
      },
      {
        type: 'eventHub',
        direction: 'out',
        name: '$return',
        eventHubName: output,
        connection: 'outputEventHubConnectionAppSeting'
      }
    ]

    functionJson.bindings = bindings;
    fsUtils.writeFile(functionDefPath, JSON.stringify(functionJson));
  }

  async postBuild(def: any) {
    const fnDir = path.join(def.buildPath, "fn")
        , tempDir = def.buildPath + "-tmp"
        ;

    fs.moveSync(def.buildPath, tempDir);
    fsUtils.mkdir(def.buildPath);
    fsUtils.mkdir(fnDir);
    fs.moveSync(tempDir, fnDir);
    
    fsUtils.writeFile(path.join(def.buildPath, "host.json"), JSON.stringify({ version: "2.0" }));
    fsUtils.writeFile(path.join(def.buildPath, "extensions.csproj"), `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
	<WarningsAsErrors></WarningsAsErrors>
	<DefaultItemExcludes>**</DefaultItemExcludes>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.WebJobs.Extensions.EventHubs" Version="3.0.3" />
    <PackageReference Include="Microsoft.Azure.WebJobs.Script.ExtensionsMetadataGenerator" Version="1.0.2" />
  </ItemGroup>
</Project>
`
    );

    await execPromise("func extensions install", { cwd: def.buildPath, env: process.env });
  }

  async uploadArtifcat(): Promise<void> {
    
  }
}