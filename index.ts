import Processor from "./src/Processor";
import ConfigUtil from "./src/Util/ConfigUtil";
import * as gitUtils from "@project-furnace/gitutils";
import { FurnaceConfig } from "./src/Model/Config";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "@pulumi/pulumi";
import * as tmp from "tmp";
import * as fsUtils from "@project-furnace/fsutils";
import Build from "./src/Build";

(async () => {
    const config = new Config("deploy")
        // , configPath: string = config.require("configPath")
        , gitRemote = "https://github.com/ProjectFurnace/dev-stack" //process.env.GIT_REMOTE
        , templateRepoRemote = "https://github.com/ProjectFurnace/function-templates"
        , gitTag = "master" //process.env.GIT_TAG
        , gitUsername = "" //process.env.GIT_USERNAME
        , gitToken = "" //process.env.GIT_TOKEN
        , environment = pulumi.getStack().split("-").pop()
        , stackName = gitRemote.split("/").pop()
        , repoDir = tmp.dirSync().name
        , templateRepoDir = tmp.dirSync().name
        ;

    await gitUtils.clone(repoDir, gitRemote, gitUsername, gitToken);
    await gitUtils.clone(templateRepoDir, templateRepoRemote, gitUsername, gitToken);

    const furnaceConfig: FurnaceConfig = await ConfigUtil.getConfig(repoDir, templateRepoDir, stackName as string, environment as string);

    Build.buildStack(repoDir, templateRepoDir, furnaceConfig.stack.platform.build.bucket, furnaceConfig.stack.platform.type);

    const processor = new Processor();
    processor.process(furnaceConfig, environment as string);

})();