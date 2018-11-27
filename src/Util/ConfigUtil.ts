import * as yaml from "yamljs";
import * as fsUtils from "@project-furnace/fsutils";
import HashUtil from "../Util/HashUtil";

import { FurnaceConfig, ModuleSpec, Pipeline } from "../Model/Config";

export default class ConfigUtil {

    static async getConfig(configPath: string): Promise<FurnaceConfig> {
        const files = [ "taps", "pipelines", "sinks", "pipes", "stack" ];

        const config: FurnaceConfig = {
            taps: [],
            pipelines: [],
            pipes: [],
            sinks: [],
            stack: { platform: { aws: {  }, build: { bucket: "" } }, state: { repo: "" }}
        };

        let moduleHashes = new Map<string, string>();
        const modulesPath = configPath + "/modules/";

        // generate hashes for modules
        const modulesList: string[] = fsUtils.listDirectory(modulesPath);
        for (let mod of modulesList) {
            const hash = await this.getModuleHash(modulesPath + mod);
            moduleHashes.set(mod, hash);
        }

        for (let file of files) {
            const filePath = configPath + "/" + file + ".yaml"; //TODO: replace with path.join

            let configObject: any = yaml.load(filePath);

            // translate into ModuleSpec's
            switch (file) {
                case "taps":
                case "sinks":
                    let specs: Array<ModuleSpec> = [];
                    for (let item of configObject as Array<any>) {
                        specs.push(this.getModuleSpec(item, moduleHashes));
                    }
                    configObject = specs;
                    break;

                case "pipelines":
                    for (let item of configObject as Array<Pipeline>) {
                        let pipelineSpecs: Array<ModuleSpec> = [];
                        for (let m of item.modules) {
                            pipelineSpecs.push(this.getModuleSpec(m, moduleHashes));
                        }
                        item.modules = pipelineSpecs;
                    }
                    break;
                }

                config[file] = configObject;
        }

        return config;
    }

    private static async getModuleHash(dir: string): Promise<string> {
        return await HashUtil.getDirectoryHash(dir);
    }

    private static getModuleSpec(item: any, modules: Map<string,string>) {
        let spec: ModuleSpec = {
            name: item.name,
            meta: {},
            module: item.module || item.name,
            config: { config: {} }
        }
        item.name = undefined;
        item.module = undefined;
        spec.config = item;
        spec.meta.hash = modules.get(spec.module);

        return spec;
    }
}