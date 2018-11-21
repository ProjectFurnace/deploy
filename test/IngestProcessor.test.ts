import IngestProcessor from "../src/IngestProcessor";
import * as yaml from "yamljs";

describe('IngestProcessor', () => {
    let config: any = yaml.load("test/fixtures/ingest.yaml");
    it('should test', () => {
        const p: IngestProcessor = new IngestProcessor();
        const result = p.process();
        console.log(config);

        expect(result).toBe(1);
    });
});