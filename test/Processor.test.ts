import Processor from "../src/Processor";
import ConfigUtil from "../src/Util/ConfigUtil";
import { FurnaceConfig } from "../src/Model/Config";

describe('Processor', () => {
    const config: FurnaceConfig = ConfigUtil.getConfig("test/fixtures/config");

    it('should accept FurnaceConfig as constructor', () => {
        const processor = new Processor(config, "test");
        
        expect(processor.config.taps).toBeDefined();
        expect(processor.config.pipelines).toBeDefined();
        expect(processor.config.sinks).toBeDefined();
    });

    it('should correctly generate flows', () => {
        const processor = new Processor(config, "test");
        const flows = processor.getFlows();

        expect(flows).toHaveLength(1);

        const flow = flows[0];
        expect(flow).toHaveLength(3);

        expect(flow[0].name).toBe("passthrough");
        expect(flow[1].name).toBe("geo");
        expect(flow[2].name).toBe("elasticsearch");
    });
});