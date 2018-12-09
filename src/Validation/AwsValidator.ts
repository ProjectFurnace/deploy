import { ModuleSpec, FurnaceConfig } from "../Model/Config";
export default class AwsValidator {
    static validate(config: FurnaceConfig, flows: Array<Array<ModuleSpec>>): string[] {
        let errors: string[] = [];

        for (let flow of flows) {
            for (let m of flow) {
                if (!m.meta.hash) errors.push(`module ${m.module} has no hash`);
            }
        }
        return errors;
    }
}