import { Model } from "@project-furnace/stack-processor";

export default class AwsValidator {
    static validate(config: Model.FurnaceConfig, flows: Array<Model.BuildSpec>): string[] {
        let errors: string[] = [];

        for (let flow of flows) {
            if (flow.type === "Function" && !flow.buildSpec!.hash) errors.push(`function ${flow.function} has no hash`);
        }
        return errors;
    }
}