import * as fsUtils from "@project-furnace/fsutils";
import * as fs from "fs-extra";
import * as path from "path";
import FunctionBuilderBase from "../FunctionBuilderBase";
import { execPromise } from "../Util/ProcessUtil";
import * as storage from "azure-storage";
import HashUtil from "../Util/HashUtil";

export default class AzureFunctionBuilder extends FunctionBuilderBase {

  blobService: storage.BlobService;
  connectionString: string;

  constructor(repoDir: string, templateRepoDir: string, reposCacheDir: string, bucket: string, platform: string, initConfig: any) {
    super(repoDir, templateRepoDir, reposCacheDir, bucket, platform, initConfig);

    this.connectionString = initConfig.storageConnectionString;

    if (!this.connectionString) throw new Error(`AzureFunctionBuilder must be initialised with storageConnectionString set in config`);

    this.blobService = storage.createBlobService(this.connectionString);
  }

  //TODO: the azure function needs a bit of double checking as packages create different hashes each time for some reason and they are always uploaded
  async preProcess(def: any) {
    super.preProcess(def);

    const functionDefPath = path.join(def.buildPath, "function.json")
      , { identifier, sources, output } = def;
    ;

    if (!fsUtils.exists(functionDefPath)) throw new Error(`cannot find function.json for function ${identifier}`);

    const rawdata = fsUtils.readFile(functionDefPath)
      , functionJson = JSON.parse(rawdata)
      ;

    const bindings = [
      {
        type: 'eventHubTrigger',
        direction: 'in',
        name: 'eventInput',
        eventHubName: sources[0],
        connection: 'inputEventHubConnectionAppSetting'
      }
    ];

    if (output) {
      bindings.push({
        type: 'eventHub',
        direction: 'out',
        name: '$return',
        eventHubName: output,
        connection: 'outputEventHubConnectionAppSetting'
      });
    }

    functionJson.bindings = bindings;
    fsUtils.writeFile(functionDefPath, JSON.stringify(functionJson));
  }

  async postBuild(def: any) {
    const fnDir = path.join(def.buildPath, "fn")
      , tempDir = def.buildPath + "-tmp"
      ;

    fs.renameSync(def.buildPath, tempDir);
    fsUtils.mkdir(def.buildPath);
    fsUtils.mkdir(fnDir);
    fs.renameSync(tempDir, fnDir);

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

  async uploadArtifcat(bucketName: string, key: string, artifact: string): Promise<any> {

    const artifactExists = await this.artifactExists(bucketName, key);

    if (artifactExists) {
      // console.log(`artifact with ${key} exists, skipping upload...`);
      return Promise.resolve();
    } else {
      return new Promise((resolve, reject) => {
        this.blobService.createBlockBlobFromLocalFile(bucketName, key, artifact, (error, result, response) => {
          if (error) reject(error)
          else resolve(result);
        });
      });
    }
  }

  async artifactExists(bucketName: string, key: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.blobService.doesBlobExist(bucketName, key, (err, result) => {
        if (err) resolve(false);
        else resolve(result.exists);
      });
    });
  }
}