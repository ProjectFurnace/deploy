import FlowGenerator from "../src/FlowGenerator";
import ConfigUtil from "../src/Util/ConfigUtil";
import { FurnaceConfig } from "../src/Model/Config";
import * as util from "util";

describe('FlowGenerator', () => {

    it('should return correct flows', async () => {
        const config = await ConfigUtil.getConfig("test/fixtures/config", );
        const flows = FlowGenerator.getFlows(config, "test");
       
        console.log(util.inspect(flows, { depth: 5 }));
        // expect(flows).toHaveLength(1);
    });

        // it('should correctly generate flows', () => {
    //     const processor = new Processor(config, "test");
    //     const flows = processor.getFlows();

    //     expect(flows).toHaveLength(1);

    //     const flow = flows[0];
    //     expect(flow).toHaveLength(3);

    //     expect(flow[0].name).toBe("passthrough");
    //     expect(flow[1].name).toBe("geo");
    //     expect(flow[2].name).toBe("elasticsearch");
    // });
});