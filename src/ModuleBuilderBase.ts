import * as fsUtils from "@project-furnace/fsutils";
import * as path from "path";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import * as yaml from "yamljs";
import * as zipUtils from "@project-furnace/ziputils";
import merge from "util.merge-packages";
import { execPromise } from "./Util/ProcessUtil";
import * as randomstring from "randomstring";
import HashUtil from "./Util/HashUtil";

export default abstract class ModuleBuilder {

  buildPath: string;
  modules: string[];

  constructor(private repoDir: string, private templateRepoDir: string, private bucket: string, private platform: string, initConfig: any) { this.modules = [] }

  async initialize() {
    if (!this.buildPath) this.buildPath = await fsUtils.createTempDirectory();
  }

  cleanup() {
    if (fsUtils.exists(this.buildPath)) fsUtils.rimraf(this.buildPath);
  }

  async processModule(buildSpec: BuildSpec, alwaysBuild: Boolean = false) {

    const def = await this.getModuleDef(buildSpec);

    if (this.modules.includes(def.name) && !alwaysBuild) {
      console.log(`module ${def.name} already built, skipping`);
      return def;
    }

    await this.preProcess(def);
    await this.buildModule(def);
    await this.postBuild(def);
    if (alwaysBuild) {
      buildSpec.buildSpec!.moduleHash = await HashUtil.getDirectoryHash(def.buildPath);
      buildSpec.buildSpec!.hash = HashUtil.combineHashes(buildSpec.buildSpec!.moduleHash, buildSpec.buildSpec!.templateHash);
    }
    await this.packageModule(def);
    await this.postProcess(def);

    this.modules.push(def.name);

    return def;
  }

  async postProcess(def: any) {
    // fsUtils.rimraf(def.buildPath);
  }

  async preProcess(def: any) {
    //TODO: We should check that there won't be any files from the module overwritten by the template and viceversa
    if (def.eventType !== "raw") {
      // if eventType is raw, we don't copy over a template
      fsUtils.cp(def.templatePath, def.buildPath);
    }
    fsUtils.cp(def.codePath, def.buildPath);
  }

  async postBuild(def: any) {}

  getModuleDef(buildSpec: BuildSpec): any {

    const name = buildSpec.module!
        , moduleRoot = path.join(this.repoDir, "modules", name)
        , infoPath = path.join(moduleRoot, "module.yaml")
        , configPath = path.join(moduleRoot, "config.yaml")
        ;

    if (!fsUtils.stat(moduleRoot).isDirectory()) throw new Error(`unable to find module directory at ${moduleRoot}`);
    if (!fsUtils.exists(infoPath)) throw new Error(`unable to find module definition at ${infoPath}`);

    const info = yaml.load(infoPath);;

    const { identifier, sources, output } = buildSpec.meta!;
    const { eventType } = buildSpec.moduleSpec;

    let def = {
      name,
      runtime: info.runtime,
      moduleRoot,
      infoPath,
      configPath,
      info,
      templatePath: `${this.templateRepoDir}/${this.platform}-${info.runtime}`,
      codePath: `${moduleRoot}/src`,
      buildPath: path.join(this.buildPath, name),
      buildArtifact: "",
      identifier,
      sources,
      output,
      eventType
    };

    def.buildArtifact = def.buildPath + ".zip"

    return def;
  }

  async buildModule(def: any) {

    // moduleDef: any, codePath: string, templatePath: string, buildPath: string
    switch (def.runtime) {
      case 'nodejs8.10':
        //in case we have 2 package.json files we need to merge them. if it's only one or none, nothing to worry about
        if (fsUtils.exists(path.join(def.templatePath, 'package.json')) && fsUtils.exists(path.join(def.codePath, 'package.json'))) {
          var dst = fsUtils.readFile(path.join(def.codePath, 'package.json'));
          var src = fsUtils.readFile(path.join(def.templatePath, 'package.json'));

          fsUtils.writeFile(path.join(def.buildPath, 'package.json'), merge(dst, src));
        }
        await this.buildNode(def.name, def.buildPath);
        break;

      case 'python3.6':
        await this.buildPython(def.name, def.buildPath);
        break;

      default:
        throw new Error(`unsupported runtime ${def.runtime} for module ${def.name}`);
    }

  }

  async packageModule(def: any) {
    await zipUtils.compress(def.buildPath, def.buildArtifact);
  }

  async buildNode(name: string, buildPath: string) {

    try {
      if (process.env.NPM_TOKEN) {
        const npmrc = "//registry.npmjs.org/:_authToken=${NPM_TOKEN}";
        fsUtils.writeFile(path.join(buildPath, ".npmrc"), npmrc);
      }

      // console.log(`building ${name} in ${buildPath}`);

      const execResult = await execPromise("npm install --production",
        { cwd: buildPath, env: process.env });

      if (execResult.stderr) {
        throw new Error(`npm install returned an error:\n${execResult.stdout}\n${execResult.stderr}`);
      }

    } catch (err) {
      throw new Error(`unable to build module ${name}: ${err}`)
    }

  }

  async buildPython(name: string, buildPath: string) {

    try {
      // console.log(`building ${name} in ${buildPath}`);

      if (fsUtils.exists(path.join(buildPath, 'requirements.txt'))) {
        // console.log('installing dependencies...')
        const execResult = await execPromise("pip install -r requirements.txt -t .",
          { cwd: buildPath, env: process.env });

        if (execResult.stderr) {
          throw new Error(`pip install returned an error:\n${execResult.stdout}\n${execResult.stderr}`);
        }
      } else {
        console.log('no requirements.txt file. skipping pip install.')
      }

    } catch (err) {
      throw new Error(`unable to build module ${name}: ${err}`)
    }

  }

  abstract async uploadArtifcat(bucketName: string, key: string, artifact: string): Promise<any>;

  validateModuleMetadata(moduleDef: any) {
    let errors = [];

    //TODO: more validation required
    if (!moduleDef.info.runtime) {
      errors.push(`runtime must be specified in the module definition file`)
    }

    return errors;
  }

}