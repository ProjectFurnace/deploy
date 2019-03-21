import ConfigUtil from "../../src/Util/ConfigUtil";
import * as util from "util";

describe('configUtil', () => {
    it('should correctly parse config', async () => {
        const config = await ConfigUtil.getConfig("test/fixtures/config", "test/fixtures/templates", "test", "aws");
        // console.log(util.inspect(config, { depth: 5 }));
        
        expect(config.sources).toBeDefined();
        expect(config.sources).toHaveLength(1);
        expect(config.sources[0].name).toBe("flowlogs");
        expect(config.sources[0].config).toBeDefined();
        expect(config.sources[0].config.aws).toBeDefined();
        expect(config.sources[0].config.aws.shardCount).toBe(1);

        expect(config.taps).toBeDefined();
        expect(config.taps).toHaveLength(1);
        expect(config.taps[0].name).toBe("flowlogs");

        expect(config.taps).toBeDefined();
        expect(config.taps).toHaveLength(1);
        expect(config.taps[0].name).toBe("flowlogs");
        
        expect(config.sinks).toBeDefined();
        expect(config.sinks).toHaveLength(2);
        expect(config.sinks[0].name).toBe("elasticsearch");
        expect(config.sinks[1].name).toBe("firehose");
        
        expect(config.pipes).toBeDefined();
        expect(config.pipes).toHaveLength(3);
        
        expect(config.resources).toBeDefined();
        expect(config.resources).toHaveLength(1);
        expect(config.resources[0].name).toBe("elasticsearch");
        
        expect(config.stack).toBeDefined();        
        expect(config.stack.name).toBe("test-stack");

    });
});