import ConfigUtil from "../../src/Util/ConfigUtil";
import * as util from "util";

describe('configUtil', () => {
    it('should correctly parse config', async () => {
        const config = await ConfigUtil.getConfig("test/fixtures/config", "test/fixtures/templates/", "test", "test");
        console.log(util.inspect(config, { depth: 5 }));
        
        expect(config.taps).toBeDefined();
        expect(config.pipelines).toBeDefined();
        expect(config.sinks).toBeDefined();
        expect(config.pipes).toBeDefined();

    });
});