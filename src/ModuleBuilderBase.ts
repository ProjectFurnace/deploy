import * as fsUtils from "@project-furnace/fsutils";
import * as path from "path";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import * as yaml from "yamljs";
import * as zipUtils from "@project-furnace/ziputils";
import merge from "util.merge-packages";

export default abstract class ModuleBuilder {

  buildPath: string;

  constructor(private repoDir: string, private templateRepoDir: string, private bucket: string, private platform: string) { }

  async initialize() {
    if (!this.buildPath) this.buildPath = await fsUtils.createTempDirectory();
  }

  cleanup() {
    if (fsUtils.exists(this.buildPath)) fsUtils.rimraf(this.buildPath);
  }

  async processModule(buildSpec: BuildSpec) {
    const moduleName = buildSpec.module!
        , moduleDir = path.join(this.repoDir, "modules", moduleName)
        , moduleInfoPath = path.join(moduleDir, "module.yaml")
        , moduleConfigPath = path.join(moduleDir, "config.yaml")
        ;

    if (!fsUtils.stat(moduleDir).isDirectory()) throw new Error(`unable to find module directory at ${moduleDir}`);
    if (!fsUtils.exists(moduleInfoPath)) throw new Error(`unable to find module definition at ${moduleInfoPath}`);

    let moduleDef: any = {
      name: moduleName,
      hash: null,
      changed: false,
      built: false,
    };

    const moduleInfo = yaml.load(moduleInfoPath);

    const templatePath = `${this.templateRepoDir}/${this.platform}-${moduleInfo.runtime}`
      , codePath = `${moduleDir}/src`
      , moduleBuildPath = path.join(this.buildPath, moduleDef.name)
      ;

    await this.prepareModule(buildSpec, templatePath, moduleBuildPath, codePath);

    const buildArtifact = await this.buildModule(moduleName, moduleInfo.runtime, codePath, templatePath, moduleBuildPath);

    return {
      ...moduleDef,
      buildArtifact
    }
  }

  async prepareModule(buildSpec: BuildSpec, templatePath: string, moduleBuildPath: string, codePath: string) {
    //TODO: We should check that there won't be any files from the module overwritten by the template and viceversa
    fsUtils.cp(templatePath, moduleBuildPath);
    fsUtils.cp(codePath, moduleBuildPath);
  }

  async buildModule(name: string, runtime: string, codePath: string, templatePath: string, moduleBuildPath: string) {

    const buildArtifactPath = moduleBuildPath + ".zip"

    // moduleDef: any, codePath: string, templatePath: string, buildPath: string
    switch (runtime) {
      case 'nodejs8.10':
        //in case we have 2 package.json files we need to merge them. if it's only one or none, nothing to worry about
        if (fsUtils.exists(path.join(templatePath, 'package.json')) && fsUtils.exists(path.join(codePath, '/package.json'))) {
          var dst = fsUtils.readFile(path.join(codePath, 'package.json'));
          var src = fsUtils.readFile(path.join(templatePath, 'package.json'));

          fsUtils.writeFile(path.join(moduleBuildPath, 'package.json'), merge(dst, src))
        }
        await this.buildNode(name, moduleBuildPath);
        break;

      case 'python3.6':
        await this.buildPython(name, moduleBuildPath);
        break;

      default:
        throw new Error(`unsupported runtime ${runtime} for module ${name}`);
    }

    await zipUtils.compress(moduleBuildPath, buildArtifactPath);

    return buildArtifactPath;
  }

  async buildNode(name: string, buildPath: string) {

    try
    {
        if (process.env.NPM_TOKEN) { 
            const npmrc = "//registry.npmjs.org/:_authToken=${NPM_TOKEN}";
            fsUtils.writeFile(path.join(buildPath, ".npmrc"), npmrc);
        }

        console.log(`building ${name} in ${buildPath}`);

        // TODO: merge dependencies from template
        const execResult = await this.execPromise("npm install --production", 
            { cwd: buildPath, env: process.env });

        if (execResult.stderr) {
            throw new Error(`npm install returned an error:\n${execResult.stdout}\n${execResult.stderr}`);
        }
        
    } catch (err) {
        throw new Error(`unable to build module ${name}: ${err}`)
    }
    
}

  async buildPython(name: string, buildPath: string) {

    try
    {
        console.log(`building ${name} in ${buildPath}`);

        if( fsUtils.exists(path.join(buildPath, 'requirements.txt')) ) {
            console.log('installing dependencies...')
            const execResult = await this.execPromise("pip install -r requirements.txt -t .", 
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

abstract async uploadArtifcat(): Promise<void>;

execPromise(command: string, options: any): any {
    const exec = require("child_process").exec;

    return new Promise((resolve, reject) => {
        exec(command, options, (error: any, stdout: any, stderr: any) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

validateModuleMetadata(moduleDef: any) {
    let errors = [];

    //TODO: more validation required
    if (!moduleDef.info.runtime) {
        errors.push(`runtime must be specified in the module definition file`)
    }

    return errors;
}

}