import ConfigUtil from "../../src/Util/ConfigUtil";

describe('configUtil', () => {
    it('should correctly parse config', async () => {
        const config = await ConfigUtil.getConfig("test/fixtures/config");

        expect(config.taps).toBeDefined();
        expect(config.pipelines).toBeDefined();
        expect(config.sinks).toBeDefined();
        expect(config.pipes).toBeDefined();
    });
});