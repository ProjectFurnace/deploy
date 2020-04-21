import * as fsUtils from "@project-furnace/fsutils";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import * as zipUtils from "@project-furnace/ziputils";
import * as pulumi from "@pulumi/pulumi";
import * as path from "path";
import merge from "util.merge-packages";
import HashUtil from "./Util/HashUtil";
import { execPromise } from "./Util/ProcessUtil";

export default abstract class FunctionBuilder {
  buildPath: string;
  functions: string[];
  functionHashes: string[] = [];

  constructor(
    private stackRepoDir: string,
    private templateRepoDir: string,
    private reposCacheDir: string,
    private bucket: string,
    private platform: string,
    initConfig: any
  ) {
    this.functions = [];
  }

  async initialize() {
    if (!this.buildPath) this.buildPath = await fsUtils.createTempDirectory();
  }

  cleanup() {
    if (fsUtils.exists(this.buildPath)) fsUtils.rimraf(this.buildPath);
  }

  async processFunction(buildSpec: BuildSpec, alwaysBuild: Boolean = false) {
    const isSandbox = process.env.FURNACE_LOCAL ? true : false;
    const homedir = require("os").homedir();
    const cacheLocation = `${homedir}/.furnace/cache/sandbox/functions`;

    if (isSandbox && !fsUtils.exists(cacheLocation))
      fsUtils.mkdir(cacheLocation);

    // const hash = HashUtil.combineHashes(
    //   buildSpec.buildSpec!.functionHash,
    //   buildSpec.buildSpec!.templateHash
    // );

    const def = await this.getFunctionDef(buildSpec);

    await this.preProcess(def);

    // create function hash when we have already merged the template and compare it to previous ones
    buildSpec.buildSpec!.functionHash = await HashUtil.getDirectoryHash(
      def.buildPath
    );
    buildSpec.buildSpec!.hash = HashUtil.combineHashes(
      buildSpec.buildSpec!.functionHash,
      buildSpec.buildSpec!.templateHash
    );

    // FIX: causes file not found error on build artifact
    // if (this.functionHashes.includes(buildSpec.buildSpec!.hash)) {
    //   console.log(`function ${def.name} already built, skipping`);
    //   return def;
    // }

    const functionCacheLocation = `${cacheLocation}/${
      buildSpec.buildSpec!.hash
    }.zip`;

    if (fsUtils.exists(functionCacheLocation)) {
      // now copy the cached version
      // if (process.env.FURNACE_DEBUG)
      console.log(
        "building from cache",
        functionCacheLocation,
        def.buildArtifact
      );

      fsUtils.cp(functionCacheLocation, def.buildArtifact);
    } else {
      // TODO: Build only when its not preview. No point in building during preview
      await this.buildFunction(def);
      await this.postBuild(def);
      // in some cases (mainly Azure) we may need to rebuild the hash after the build. Worth double-checking
      // if this is still necessary after the latest changes to fix the functionHash after preProcess
      if (alwaysBuild) {
        buildSpec.buildSpec!.functionHash = await HashUtil.getDirectoryHash(
          def.buildPath
        );
        buildSpec.buildSpec!.hash = HashUtil.combineHashes(
          buildSpec.buildSpec!.functionHash,
          buildSpec.buildSpec!.templateHash
        );
      }
      await this.packageFunction(def);
      await this.postProcess(def);
    }

    this.functions.push(def.name);
    this.functionHashes.push(buildSpec.buildSpec!.hash);

    if (isSandbox && !fsUtils.exists(functionCacheLocation)) {
      fsUtils.cp(def.buildArtifact, functionCacheLocation);
    }

    return def;
  }

  async postBuild(def: any) {}

  getFunctionDef(buildSpec: BuildSpec): any {
    let name = "";

    // if we have more than one function in our array this is a combined function
    if (buildSpec.functionSpec.functions.length > 1) {
      // use the meta identifier if that is the case
      name = buildSpec.meta!.identifier;
    } else {
      // otherwise use the function name
      name = buildSpec.functionSpec.functions[0].function!;
    }

    const codePaths: any = {};

    for (const func of buildSpec.functionSpec.functions) {
      // add only to codepaths if we haven't already processed that function
      if (!Object.keys(codePaths).includes(func.function)) {
        const fncRoot = func.repo
          ? path.join(this.reposCacheDir, func.repo, func.function)
          : path.join(this.stackRepoDir, "src", func.function);
        if (!fsUtils.stat(fncRoot).isDirectory()) {
          throw new Error(`unable to find function directory at ${fncRoot}`);
        }
        codePaths[func.function] = path.join(fncRoot, "src");
      }
    }

    const { identifier, sources, output } = buildSpec.meta!;
    const { eventType, runtime } = buildSpec.functionSpec;

    const buildPath = path.join(this.buildPath, name);

    const def = {
      name,
      runtime,
      templatePath: `${this.templateRepoDir}/${this.platform}-${runtime}`,
      codePaths,
      buildPath: buildPath,
      buildArtifact: buildPath + ".zip",
      identifier,
      sources,
      output,
      eventType,
    };

    return def;
  }

  protected async preProcess(def: any) {
    //TODO: We should check that there won't be any files from the function overwritten by the template and viceversa

    if (fsUtils.exists(def.buildPath)) {
      console.log(
        `build path exists in build pre process, skipping ${def.buildPath}`
      );
      return;
    }

    if (def.eventType !== "raw") {
      // if eventType is raw, we don't copy over a template
      fsUtils.cp(def.templatePath, def.buildPath);
    }

    if (def.codePaths) {
      const combined = Object.keys(def.codePaths).length > 1 ? true : false;
      for (const key of Object.keys(def.codePaths)) {
        const codePath = def.codePaths[key];
        // if we have more than one function, place the code inside folders
        if (combined) {
          fsUtils.cp(codePath, path.join(def.buildPath, "combined", key));
        } else {
          fsUtils.cp(codePath, def.buildPath);
        }
      }
    }
  }

  protected async postProcess(def: any) {
    // fsUtils.rimraf(def.buildPath);
  }

  async buildFunction(def: any) {
    console.log(`building ${def.name}...`);
    // functionDef: any, codePath: string, templatePath: string, buildPath: string
    switch (def.runtime) {
      case "nodejs8.10":
      case "nodejs12.x":
        // in case we have more than one package.json file we need to merge
        // them. if it's only one or none, nothing to worry about
        let templatePackage = "{}";
        if (fsUtils.exists(path.join(def.templatePath, "package.json"))) {
          templatePackage = fsUtils.readFile(
            path.join(def.templatePath, "package.json")
          );
        }

        for (const key in def.codePaths) {
          if (fsUtils.exists(path.join(def.codePaths[key], "package.json"))) {
            const functionPackage = fsUtils.readFile(
              path.join(def.codePaths[key], "package.json")
            );

            templatePackage = merge(functionPackage, templatePackage);
          }
        }
        fsUtils.writeFile(
          path.join(def.buildPath, "package.json"),
          templatePackage
        );
        // do not build on preview
        // if (!pulumi.runtime.isDryRun()) {
        await this.buildNode(def.name, def.buildPath);
        // }
        break;

      case "python3.6":
        //in case we have 2 requirements.txt files we need to merge them. if it's only one or none, nothing to worry about
        let templateRequirements = "";
        if (fsUtils.exists(path.join(def.templatePath, "requirements.txt")))
          templateRequirements = fsUtils.readFile(
            path.join(def.templatePath, "requirements.txt")
          );

        for (const key in def.codePaths) {
          if (
            fsUtils.exists(path.join(def.codePaths[key], "requirements.txt"))
          ) {
            let functionRequirements = fsUtils.readFile(
              path.join(def.codePaths[key], "requirements.txt")
            );
            // if we are combining functions we need them to be treated as modules
            if (def.codePaths.length > 1)
              fsUtils.writeFile(
                path.join(def.codePaths[key], "__init__.py"),
                ""
              );

            templateRequirements =
              templateRequirements + "\n" + functionRequirements;
          }
        }
        fsUtils.writeFile(
          path.join(def.buildPath, "requirements.txt"),
          templateRequirements
        );

        // do not build on preview
        // if (!pulumi.runtime.isDryRun()) {
        await this.buildPython(def.name, def.buildPath);
        // }
        break;

      default:
        throw new Error(
          `unsupported runtime ${def.runtime} for function ${def.name}`
        );
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

      const execResult = await execPromise("npm install --production", {
        cwd: buildPath,
        env: process.env,
      });

      if (execResult.stderr) {
        throw new Error(
          `npm install returned an error:\n${execResult.stdout}\n${execResult.stderr}`
        );
      }
    } catch (err) {
      throw new Error(`unable to build function ${name}: ${err}`);
    }
  }

  async buildPython(name: string, buildPath: string) {
    try {
      // console.log(`building ${name} in ${buildPath}`);

      if (fsUtils.exists(path.join(buildPath, "requirements.txt"))) {
        // console.log('installing dependencies...')
        const execResult = await execPromise(
          "pip3 install -r requirements.txt -t .",
          { cwd: buildPath, env: process.env }
        );

        if (execResult.stderr) {
          throw new Error(
            `pip install returned an error:\n${execResult.stdout}\n${execResult.stderr}`
          );
        }
      } else {
        console.log("no requirements.txt file. skipping pip install.");
      }
    } catch (err) {
      throw new Error(`unable to build function ${name}: ${err}`);
    }
  }

  abstract async uploadArtifcat(
    bucketName: string,
    key: string,
    artifact: string
  ): Promise<any>;
}
