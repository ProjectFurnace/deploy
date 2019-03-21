import { Model } from "@project-furnace/stack-processor";

export default class AwsValidator {
    static validate(config: Model.FurnaceConfig, flows: Array<Model.BuildSpec>): string[] {
        let errors: string[] = [];

        for (let flow of flows) {
            if (flow.type === "Module" && !flow.buildSpec!.hash) errors.push(`module ${flow.module} has no hash`);
        }
        return errors;
    }
}