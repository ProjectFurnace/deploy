import AwsFlowProcessor from "./AwsFlowProcessor";
import { FurnaceConfig, ModuleSpec } from "./Model/Config"
import FlowGenerator from "../src/FlowGenerator";

export default class Processor {

    // constructor(config: FurnaceConfig, private environment: string) {
    constructor() {

    }

    process(config: FurnaceConfig, environment: string) {
        const flows = FlowGenerator.getFlows(config, environment);

        const platformType = "aws"; //this.config.stack!.platform!.type

        switch(platformType) {
            case "aws":
                new AwsFlowProcessor(flows, config, environment);
                break;
            default:
                throw new Error("unknown stack platform type");
        }
    }

}
