import * as yaml from "yamljs";

import { FurnaceConfig, Stack } from "../Model/Config";

export default class ConfigUtil {
    static getConfig(configPath: string): FurnaceConfig {
        const files = [ "taps", "pipelines", "sinks", "pipes", "stack" ];

        const config: FurnaceConfig = {
            taps: [],
            pipelines: [],
            pipes: [],
            sinks: [],
            stack: <Stack>{}
        };

        for (let file of files) {
            const filePath = configPath + "/" + file + ".yaml"; //TODO: replace with path.join

            let configObject: any = yaml.load(filePath);

            config[file] = configObject;
        }

        return config;
    }
}