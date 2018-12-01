import Processor from "../src/Processor";
import ConfigUtil from "../src/Util/ConfigUtil";
import { FurnaceConfig } from "../src/Model/Config";

describe('Processor', () => {
    
    let config: FurnaceConfig;
    let processor: Processor;

    beforeEach(async () => {
        config = await ConfigUtil.getConfig("test/fixtures/config", "test/fixtures/templates");
        processor = new Processor();
    });




});