import * as fsUtils from "@project-furnace/fsutils";
import * as zipUtils from "@project-furnace/ziputils";
import * as s3Utils from "@project-furnace/s3utils";
import * as path from "path";
import * as yaml from "yamljs";
import HashUtil from "./Util/HashUtil";
import * as util from "util";
import merge from "util.merge-packages";

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

                    console.log(`got build artifact for ${moduleDef.name} at ${buildArtifactPath}`)

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
                        console.log(`uploaded module ${moduleDef.name} to s3`)
                        
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

        //TODO: We should check that there won't be any files from the module overwritten by the template and viceversa
        fsUtils.cp(templatePath, buildPath);
        fsUtils.cp(codePath, buildPath);

        switch (runtime) {
            case 'nodejs8.10':
                //in case we have 2 package.json files we need to merge them. if it's only one or none, nothing to worry about
                if(fsUtils.exists(path.join(templatePath, '/package.json')) && fsUtils.exists(path.join(codePath, '/package.json'))) {
                    var dst = fsUtils.readFile(path.join(codePath, '/package.json'));
                    var src = fsUtils.readFile(path.join(templatePath, '/package.json'));

                    fsUtils.writeFile(path.join(buildPath, '/package.json'), merge(dst, src))
                }
                await this.buildNode(name, buildPath);
                break;
            
            case 'python3.6':
                await this.buildPython(name, buildPath);
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
            if (process.env.NPM_TOKEN) { 
                const npmrc = "//registry.npmjs.org/:_authToken=${NPM_TOKEN}";
                fsUtils.writeFile(path.join(buildPath, ".npmrc"), npmrc);
            }

            // console.log(`building ${name} in ${buildPath}`);

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

    static async buildPython(name: string, buildPath: string) {

        try
        {
            // console.log(`building ${name} in ${buildPath}`);

            if( fsUtils.exists(path.join(buildPath, 'requirements.txt')) ) {
                // console.log('installing dependencies...')
                const execResult = await this.execPromise("pip3 install -r requirements.txt --system -t .", 
                    { cwd: buildPath, env: process.env });

                if (execResult.stderr) {
                    throw new Error(`pip3 install returned an error:\n${execResult.stdout}\n${execResult.stderr}`);
                }
            } else {
                console.log('no requirements.txt file. skipping pip install.')
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
