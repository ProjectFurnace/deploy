import AwsFlowProcessor from "./AwsFlowProcessor";
import { FurnaceConfig, ModuleSpec } from "./Model/Config"
import FlowGenerator from "../src/FlowGenerator";

export default class Processor {

    process(config: FurnaceConfig, environment: string, buildBucket: string) {
        const flows = FlowGenerator.getFlows(config, environment);

        const platformType = "aws"; //this.config.stack!.platform!.type

        switch(platformType) {
            case "aws":
                new AwsFlowProcessor(flows, config, environment, buildBucket);
                break;
            default:
                throw new Error("unknown stack platform type");
        }
    }

}
