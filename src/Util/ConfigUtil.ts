import * as yaml from "yamljs";

import { FurnaceConfig } from "../Model/Config";

export default class ConfigUtil {
    static getConfig(configPath: string): FurnaceConfig {
        const files = [ "taps", "pipelines", "sinks", "pipes" ];

        const config: FurnaceConfig = {
            taps: [],
            pipelines: [],
            pipes: [],
            sinks: []
        };

        for (let file of files) {
            const filePath = configPath + "/" + file + ".yaml"; //TODO: replace with path.join

            let configObject: any = yaml.load(filePath);

            config[file] = configObject;
        }

        return config;
    }
}