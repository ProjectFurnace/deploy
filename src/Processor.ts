import AwsFlowProcessor from "./AwsFlowProcessor";
import { FurnaceConfig } from "./Model/Config"
import FlowGenerator from "../src/FlowGenerator";

export default class Processor {

    async process(config: FurnaceConfig, environment: string, buildBucket: string) {
        const flows = FlowGenerator.getFlows(config, environment);

        const platformType = "aws"; //this.config.stack!.platform!.type

        switch(platformType) {
            case "aws":
                const processor = new AwsFlowProcessor(flows, config, environment, buildBucket);
                await processor.run();
                break;
            default:
                throw new Error("unknown stack platform type");
        }
    }

}
