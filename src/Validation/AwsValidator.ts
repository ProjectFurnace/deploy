import { ModuleSpec, FurnaceConfig } from "../Model/Config";
export default class AwsValidator {
    static validate(config: FurnaceConfig, flows: Array<Array<ModuleSpec>>): string[] {
        let errors: string[] = [];

        if (!config.stack.platform) errors.push("stack has no platform config set");
        const platform = config.stack.platform!;

        if (!platform.build.bucket) errors.push(`no build bucket set for stack`);

        if (!platform.type) errors.push(`platform type not set`);

        for (let flow of flows) {
            for (let m of flow) {
                if (!m.meta.hash) errors.push(`module ${m.module} has no hash`);
            }
        }
        return errors;
    }
}