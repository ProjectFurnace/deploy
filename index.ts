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
        , codeRepo = process.env.CODE_REPO_URL
        , codeRepoTag = "master" //process.env.GIT_TAG
        , codeRepoUsername = process.env.CODE_REPO_USER
        , codeRepoToken = process.env.CODE_REPO_TOKEN
        , environment = pulumi.getStack().split("-").pop()
        , tmpDir = tmp.dirSync().name;
        ;

    await GitUtil.clone(tmpDir, codeRepo, codeRepoUsername, codeRepoToken);

    const furnaceConfig: FurnaceConfig = ConfigUtil.getConfig(tmpDir)

    console.log(furnaceConfig);

    const processor = new Processor(furnaceConfig, environment as string);
    processor.process();

})();