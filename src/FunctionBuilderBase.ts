import * as fsUtils from "@project-furnace/fsutils";
import * as path from "path";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import * as yaml from "yamljs";
import * as zipUtils from "@project-furnace/ziputils";
import merge from "util.merge-packages";
import { execPromise } from "./Util/ProcessUtil";
import * as randomstring from "randomstring";
import HashUtil from "./Util/HashUtil";

export default abstract class FunctionBuilder {

  buildPath: string;
  functions: string[];

  constructor(private repoDir: string, private templateRepoDir: string, private bucket: string, private platform: string, initConfig: any) { this.functions = [] }

  async initialize() {
    if (!this.buildPath) this.buildPath = await fsUtils.createTempDirectory();
  }

  cleanup() {
    if (fsUtils.exists(this.buildPath)) fsUtils.rimraf(this.buildPath);
  }

  async processFunction(buildSpec: BuildSpec, alwaysBuild: Boolean = false) {

    const def = await this.getFunctionDef(buildSpec);

    if (this.functions.includes(def.name) && !alwaysBuild) {
      console.log(`function ${def.name} already built, skipping`);
      return def;
    }

    await this.preProcess(def);
    await this.buildFunction(def);
    await this.postBuild(def);
    if (alwaysBuild) {
      buildSpec.buildSpec!.functionHash = await HashUtil.getDirectoryHash(def.buildPath);
      buildSpec.buildSpec!.hash = HashUtil.combineHashes(buildSpec.buildSpec!.functionHash, buildSpec.buildSpec!.templateHash);
    }
    await this.packageFunction(def);
    await this.postProcess(def);

    this.functions.push(def.name);

    return def;
  }

  async postProcess(def: any) {
    // fsUtils.rimraf(def.buildPath);
  }

  async preProcess(def: any) {
    //TODO: We should check that there won't be any files from the function overwritten by the template and viceversa
    if (def.eventType !== "raw") {
      // if eventType is raw, we don't copy over a template
      fsUtils.cp(def.templatePath, def.buildPath);
    }
    fsUtils.cp(def.codePath, def.buildPath);
  }

  async postBuild(def: any) {}

  getFunctionDef(buildSpec: BuildSpec): any {

    const name = buildSpec.function!
        , functionRoot = path.join(this.repoDir, "src", name)
        , infoPath = path.join(functionRoot, "function.yaml")
        , configPath = path.join(functionRoot, "config.yaml")
        ;

    if (!fsUtils.stat(functionRoot).isDirectory()) throw new Error(`unable to find function directory at ${functionRoot}`);
    if (!fsUtils.exists(infoPath)) throw new Error(`unable to find function definition at ${infoPath}`);

    const info = yaml.load(infoPath);;

    const { identifier, sources, output } = buildSpec.meta!;
    const { eventType } = buildSpec.functionSpec;

    let def = {
      name,
      runtime: info.runtime,
      functionRoot,
      infoPath,
      configPath,
      info,
      templatePath: `${this.templateRepoDir}/${this.platform}-${info.runtime}`,
      codePath: `${functionRoot}/src`,
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

  async buildFunction(def: any) {

    // functionDef: any, codePath: string, templatePath: string, buildPath: string
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
        //in case we have 2 requirements.txt files we need to merge them. if it's only one or none, nothing to worry about
        if (fsUtils.exists(path.join(def.templatePath, 'requirements.txt')) && fsUtils.exists(path.join(def.codePath, 'requirements.txt'))) {
          var dst = fsUtils.readFile(path.join(def.codePath, 'requirements.txt'));
          var src = fsUtils.readFile(path.join(def.templatePath, 'requirements.txt'));

          fsUtils.writeFile(path.join(def.buildPath, 'requirements.txt'), src + "\n" + dst);
        }
        await this.buildPython(def.name, def.buildPath);
        break;

      default:
        throw new Error(`unsupported runtime ${def.runtime} for function ${def.name}`);
    }

  }

  async packageFunction(def: any) {
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
      throw new Error(`unable to build function ${name}: ${err}`)
    }

  }

  async buildPython(name: string, buildPath: string) {

    try {
      // console.log(`building ${name} in ${buildPath}`);

      if (fsUtils.exists(path.join(buildPath, 'requirements.txt'))) {
        // console.log('installing dependencies...')
        const execResult = await execPromise("pip3 install -r requirements.txt -t .",
          { cwd: buildPath, env: process.env });

        if (execResult.stderr) {
          throw new Error(`pip install returned an error:\n${execResult.stdout}\n${execResult.stderr}`);
        }
      } else {
        console.log('no requirements.txt file. skipping pip install.')
      }

    } catch (err) {
      throw new Error(`unable to build function ${name}: ${err}`)
    }

  }

  abstract async uploadArtifcat(bucketName: string, key: string, artifact: string): Promise<any>;

  validateFunctionMetadata(functionDef: any) {
    let errors = [];

    //TODO: more validation required
    if (!functionDef.info.runtime) {
      errors.push(`runtime must be specified in the function definition file`)
    }

    return errors;
  }

}