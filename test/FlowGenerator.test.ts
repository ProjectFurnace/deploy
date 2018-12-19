import FlowGenerator from "../src/FlowGenerator";
import ConfigUtil from "../src/Util/ConfigUtil";
import { FurnaceConfig } from "../src/Model/Config";
import * as util from "util";
import { stringify } from "querystring";

describe('FlowGenerator', () => {

    it('should return correct flow definitions', async () => {
        const config = await ConfigUtil.getConfig("test/fixtures/config", "test/fixtures/templates", "test", "aws");

        const flows = FlowGenerator.getFlows(config, "test");
        // console.log(util.inspect(flows, { depth: 5 }));

        expect(flows).toHaveLength(1);
        const flow = flows[0];
        expect(flow).toHaveLength(5);

        const expectedFlow1 = { 
            name: 'flowlogs',
            meta:
            { moduleHash: '3676178368ad9f4f03bf47bfe276bab0a33b1004',
                templateHash: '0a4d31e3c964a452530437020def30a5bcd35ad0',
                hash: '40c34967321243a156c37ec1f065eb56600e6ad4',
                output: 'test-stack-flowlogs-test-out',
                source: 'test-stack-flowlogs-test',
                identifier: 'test-stack-flowlogs-test' 
            },
            runtime: 'nodejs8.10',
            config: { aws: { shards: 1 } },
            parameters: new Map<string,string>(),
            type: 'Module',
            component: 'tap',
            module: 'aws-vpcfl',
            source: 'flowlogs'
        }

        expect(flow[0]).toMatchObject(expectedFlow1);
        expect(flow[1].name).toBe("geo");
        expect(flow[2].name).toBe("inventory");
        expect(flow[3].name).toBe("elasticsearch");
        expect(flow[4].name).toBe("firehose");

    });

});