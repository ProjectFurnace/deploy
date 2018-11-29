import Processor from "./src/Processor";
import ConfigUtil from "./src/Util/ConfigUtil";
import GitUtil from "./src/Util/GitUtil";
import { FurnaceConfig } from "./src/Model/Config";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "@pulumi/pulumi";
import * as tmp from "tmp";
import * as fsUtils from "@project-furnace/fsutils";

(async () => {
    const config = new Config("deploy")
        // , configPath: string = config.require("configPath")
        , gitRemote = "https://github.com/ProjectFurnace/dev-stack" //process.env.GIT_REMOTE
        , templateRepoRemote = "https://github.com/ProjectFurnace/function-templates"
        , gitTag = "master" //process.env.GIT_TAG
        , gitUsername = "" //process.env.GIT_USERNAME
        , gitToken = "" //process.env.GIT_TOKEN
        , environment = pulumi.getStack().split("-").pop()
        , repoDir = tmp.dirSync().name
        , templateRepoDir = tmp.dirSync().name
        ;

    await GitUtil.clone(repoDir, gitRemote, gitUsername, gitToken);
    await GitUtil.clone(templateRepoDir, templateRepoRemote, gitUsername, gitToken);

    const furnaceConfig: FurnaceConfig = await ConfigUtil.getConfig(repoDir);

    const processor = new Processor(furnaceConfig, environment as string);
    processor.process();

})();