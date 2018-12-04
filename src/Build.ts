import * as fsUtils from "@project-furnace/fsutils";
import * as zipUtils from "@project-furnace/ziputils";
import * as s3Utils from "@project-furnace/s3utils";
import * as path from "path";
import * as yaml from "yamljs";
import HashUtil from "./Util/HashUtil";
import * as util from "util";

export default class Build {

    static async buildStack(repoDir: string, templateRepoDir: string, bucket: string, platform: string) {

        let buildDef: any = { modules: [] }
          , repoPath
          , templatePath
          , buildPath
          ;

        try {
            const buildPath = await fsUtils.createTempDirectory();

            // get the contents of the modules directory and decide if we need to build
            const contents = fsUtils.listDirectory(path.join(repoDir, "modules"));
            for (let item of contents) {
                const moduleDir = path.join(repoDir, "modules", item)
                    , moduleInfoPath = path.join(moduleDir, "module.yaml")
                    , moduleConfigPath = path.join(moduleDir, "config.yaml")
                    ;
                
                if (fsUtils.stat(moduleDir).isDirectory() && fsUtils.exists(moduleInfoPath)) {

                    let moduleDef: any = {
                        name: item,
                        hash: null,
                        changed: false,
                        built: false,
                        info: yaml.load(moduleInfoPath)
                    };
                    buildDef.modules.push(moduleDef);
                    
                    const templatePath = `${templateRepoDir}/${platform}-${moduleDef.info.runtime}`
                        , codePath = `${moduleDir}/src`
                        , moduleBuildPath = path.join(buildPath, moduleDef.name)
                        ;

                    let buildArtifactPath;
                    
                    // try {
                        buildArtifactPath = await this.buildModule(moduleDef, codePath, templatePath, moduleBuildPath);
                    // } catch (err) {
                    //     moduleDef.error = "unable to build module: " + err;
                    //     continue;
                    // }

                    moduleDef.moduleHash = await HashUtil.getDirectoryHash(moduleDir);
                    moduleDef.templateHash = await HashUtil.getDirectoryHash(templatePath);
                    moduleDef.hash = HashUtil.combineHashes(moduleDef.moduleHash, moduleDef.templateHash);

                    const s3Key = `${item}/${moduleDef.hash}`;

                    const moduleVersionExists = await s3Utils.objectExists(bucket, s3Key);
                    if (moduleVersionExists) {
                        console.debug(`module ${s3Key} exists skipping.`);
                        continue;
                    }

                    moduleDef.changed = true;

                    const moduleConfigExists = fsUtils.exists(moduleConfigPath);
                    if (moduleConfigExists) {
                        moduleDef.config = yaml.load(moduleConfigPath);
                    }

                    moduleDef.errors = this.validateModuleMetadata(moduleDef);
                    if (moduleDef.errors.length > 0) {
                        continue;
                    }               

                    try {
                        const uploadResult = await s3Utils.upload(bucket, s3Key, buildArtifactPath);
                        moduleDef.uploadResult = uploadResult;
                    } catch (err) {
                        moduleDef.error = "unable to build module: " + err;
                        continue;
                    }

                    moduleDef.built = true;
                    
                } else {
                    console.debug("skipping", moduleDir, moduleInfoPath);
                }
            }
        }
        catch (err) {
            throw new Error(`error building stack ${repoPath}: ${err}`)
        }
        finally {
            if (repoPath) fsUtils.rimraf(repoPath);
            if (templatePath) fsUtils.rimraf(templatePath);
            if (buildPath) fsUtils.rimraf(buildPath);
            
        }

        return buildDef;

    }

    static async buildModule(moduleDef: any, codePath: string, templatePath: string, buildPath: string) {

        const buildArtifactPath = buildPath + ".zip"
            , name = moduleDef.name
            , runtime = moduleDef.info.runtime
            ;

        fsUtils.cp(templatePath, buildPath);
        fsUtils.cp(codePath, buildPath);

        switch (runtime) {
            case "nodejs8.10":
                await this.buildNode(name, buildPath);
                break;

            default:
                throw new Error(`unsupported runtime ${runtime} for module ${name}`);
        }

        await zipUtils.compress(buildPath, buildArtifactPath);

        return buildArtifactPath;
    }

    static async buildNode(name: string, buildPath: string) {

        try
        {
            // TODO: merge dependencies from template
            const execResult = await this.execPromise("npm install", { cwd: buildPath });

            if (execResult.stderr) {
                throw new Error("npm install returned an error: " + execResult.stderr);
            }
            
        } catch (err) {
            throw new Error(`unable to build module ${name}: ${err}`)
        }
        
    }

    static execPromise(command: string, options: any): any {
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

    static validateModuleMetadata(moduleDef: any) {
        let errors = [];

        //TODO: more validation required
        if (!moduleDef.info.runtime) {
            errors.push(`runtime must be specified in the module definition file`)
        }

        return errors;
    }
}