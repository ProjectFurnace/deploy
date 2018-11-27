import Processor from "./src/Processor";
import ConfigUtil from "./src/Util/ConfigUtil";
import GitUtil from "./src/Util/GitUtil";
import { FurnaceConfig } from "./src/Model/Config";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "@pulumi/pulumi";
import * as tmp from "tmp";

(async () => {
    const config = new Config("deploy")
        // , configPath: string = config.require("configPath")
        , gitRemote = "https://github.com/ProjectFurnace/dev-stack" //process.env.GIT_REMOTE
        , gitTag = "master" //process.env.GIT_TAG
        , gitUsername = "" //process.env.GIT_USERNAME
        , gitToken = "" //process.env.GIT_TOKEN
        , environment = pulumi.getStack().split("-").pop()
        , tmpDir = tmp.dirSync().name;
        ;

    await GitUtil.clone(tmpDir, gitRemote, gitUsername, gitToken);

    const furnaceConfig: FurnaceConfig = await ConfigUtil.getConfig(tmpDir);

    const processor = new Processor(furnaceConfig, environment as string);
    processor.process();

})();