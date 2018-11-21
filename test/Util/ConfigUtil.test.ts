import ConfigUtil from "../../src/Util/ConfigUtil";

describe('configUtil', () => {
    it('should correctly parse config', () => {
        const config = ConfigUtil.getConfig("test/fixtures/config");

        expect(config.ingests).toBeDefined();
        expect(config.pipelines).toBeDefined();
        expect(config.sinks).toBeDefined();
        expect(config.pipes).toBeDefined();
    });
});