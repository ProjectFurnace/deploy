import * as yaml from "yamljs";
import * as fsUtils from "@project-furnace/fsutils";
import HashUtil from "../Util/HashUtil";
import * as path from "path";
import { FurnaceConfig, ModuleSpec, Pipeline, Tap } from "../Model/Config";

export default class ConfigUtil {

    static async getConfig(configPath: string, templatesPath: string, stackName: string, environment: string): Promise<FurnaceConfig> {
        const files = [ "stack", "sources", "taps", "pipelines", "sinks", "pipes", "resources" ];

        const config: FurnaceConfig = {
            sources: [],
            taps: [],
            pipelines: [],
            pipes: [],
            sinks: [],
            stack: { name: stackName, platform: { type: "", aws: {  }, build: { bucket: "" } }, state: { repo: "" }},
            resources: []
        };

        const modulesPath = path.join(configPath, "modules");
        const moduleHashes = await this.getHashListFromDirectory(modulesPath, null);
        const templateHashes = await this.getHashListFromDirectory(templatesPath, null);

        for (let file of files) {
            const filePath = path.join(configPath, file + ".yaml");
            if (!fsUtils.exists(filePath)) {
                console.log(`WARNING: file ${file} does not exist in config`);
                continue;
            }

            let configObject: any = yaml.load(filePath);

            // translate into ModuleSpec's
            switch (file) {
                case "taps":
                case "sinks":
                    let specs: Array<ModuleSpec> = [];
                    for (let item of configObject as Array<ModuleSpec>) {
                        specs.push(this.getModuleSpec(file, item, moduleHashes, templateHashes, config.stack.platform.type, modulesPath, environment));
                    }
                    configObject = specs;
                    break;

                case "pipelines":
                    for (let item of configObject as Array<Pipeline>) {
                        let pipelineSpecs: Array<ModuleSpec> = [];
                        for (let m of item.modules) {
                            pipelineSpecs.push(this.getModuleSpec(file, m, moduleHashes, templateHashes, config.stack.platform.type, modulesPath, environment));
                        }
                        item.modules = pipelineSpecs;
                    }
                    break;
                }

                config[file] = configObject;
        }

        return config;
    }

    private static async getHashListFromDirectory(dir: string, subDir: string | null): Promise<Map<string, string>> {
        let hashes = new Map<string, string>();
        const list: string[] = fsUtils.listDirectory(dir);
        for (let item of list) {
            if (item.startsWith(".")) continue;
            const p = subDir ? path.join(dir, item, subDir as string) : path.join(dir, item);
            const hash = await this.getModuleHash(p);
            hashes.set(item, hash);
        }
        return hashes;
    }

    private static async getModuleHash(dir: string): Promise<string> {
        return await HashUtil.getDirectoryHash(dir);
    }

    private static getModuleSpec(file: string, item: any, modules: Map<string,string>, templates: Map<string,string>, platform: string, modulesPath: string, environment: string) {

        if (!platform) throw new Error("platform type is not set");

        let spec: ModuleSpec = {
            name: item.name,
            meta: {},
            module: item.module || item.name,
            runtime: "",
            config: { },
            parameters: new Map<string, string>()
        }

        const moduleSpecFile = path.join(modulesPath, spec.module, "module.yaml");
        const configSpecFile = path.join(modulesPath, spec.module, "config.yaml");

        let moduleSpec: any = yaml.load(moduleSpecFile);
        let moduleConfigSpec: any = yaml.load(configSpecFile);

        if (!moduleSpec.runtime) throw new Error(`module ${item.module} has no runtime specified`)
        else spec.runtime = moduleSpec.runtime;

        if (moduleConfigSpec["config-groups"]) {
            for(let group in moduleConfigSpec["config-groups"]) {
                const paramList = moduleConfigSpec["config-groups"][group];
                for (let key in paramList) {
                    const param = paramList[key];

                    const value = item.config[key];
                    if (!value && param.mandatory && !param.default) throw new Error(`module ${spec.module} has mandatory parameter ${key} which is not set`);

                    spec.parameters.set(key, value || param.default);
                }
            }
        }

        const platformConfigs = ["aws"];
        for (let p of platformConfigs) {
            if (item[p]) spec.config[p] = item[p];
        }

        const moduleHash = modules.get(spec.module);
        if (!moduleHash) throw new Error(`unable to get hash for module ${spec.module}`);

        const template = `${platform}-${spec.runtime}`;
        const templateHash = templates.get(template);
        if (!templateHash) throw new Error(`unable to get hash for template ${template}`);

        spec.meta.moduleHash = moduleHash;
        spec.meta.templateHash = templateHash;
        spec.meta.hash = HashUtil.combineHashes(moduleHash, templateHash);
        
        if (file !== "sinks") {
            spec.meta.output = `${spec.name}-${environment}-out`;
        }

        if (file === "taps") {
            const tap = spec as Tap;
            tap.source = item.source;
            delete item.source;
        }

        return spec;
    }
}