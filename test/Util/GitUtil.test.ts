import GitUtil from "../../src/Util/GitUtil";
import * as tmp from "tmp";
import * as fs from "fs";

describe('GitUtil', () => {
    describe('clone', () => {
        it('should successfully clone', async () => {
            const tmpDir = tmp.dirSync().name;

            await GitUtil.clone(tmpDir, "https://github.com/isaacs/rimraf", "", "");

            const exists = fs.existsSync(tmpDir + "/package.json");
            expect(exists).toBe(true);
        });
    });
});