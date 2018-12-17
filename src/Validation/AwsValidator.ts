import { FlowSpec, FurnaceConfig } from "../Model/Config";
export default class AwsValidator {
    static validate(config: FurnaceConfig, flows: Array<Array<FlowSpec>>): string[] {
        let errors: string[] = [];

        for (let flow of flows) {
            for (let m of flow) {
                if (m.type === "Module" && !m.meta.hash) errors.push(`module ${m.module} has no hash`);
            }
        }
        return errors;
    }
}