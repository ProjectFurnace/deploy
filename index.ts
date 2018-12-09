import Processor from "./src/Processor";
import ConfigUtil from "./src/Util/ConfigUtil";
import * as gitUtils from "@project-furnace/gitutils";
import { FurnaceConfig } from "./src/Model/Config";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "@pulumi/pulumi";
import * as tmp from "tmp";
import * as fsUtils from "@project-furnace/fsutils";
import Build from "./src/Build";
import * as path from "path";

(async () => {
    const gitRemote = process.env.GIT_REMOTE // "https://github.com/ProjectFurnace/dev-stack"
        , gitTag = process.env.GIT_TAG //"master"
        , gitUsername = process.env.GIT_USERNAME
        , gitToken = process.env.GIT_TOKEN
        , buildBucket = process.env.BUILD_BUCKET
        , environment = pulumi.getStack().split("-").pop()
        , stackName = gitRemote!.split("/").pop()
        , platform = process.env.PLATFORM
        , repoDir = "/tmp/stack/"
        , modulesDir = path.join(repoDir, "modules")
        , templateRepoRemote = "https://github.com/ProjectFurnace/function-templates"
        , templateRepoDir = tmp.dirSync().name
        ;

    if (!gitRemote) throw new Error(`GIT_REMOTE not set`);
    if (!gitTag) throw new Error(`GIT_TAG not set`);
    if (!gitUsername) throw new Error(`GIT_USERNAME not set`);
    if (!gitToken) throw new Error(`GIT_TOKEN not set`);
    if (!platform) throw new Error(`PLATFORM not set`);
    if (!environment) throw new Error(`unable to extract environment`);
    if (!stackName) throw new Error(`unable to extract stack name`);

    if (!fsUtils.exists(modulesDir)) throw new Error(`stack must have a modules directory`);

    //TODO: check AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY if platform is aws

    await gitUtils.clone(templateRepoDir, templateRepoRemote, gitUsername!, gitToken!);

    const furnaceConfig: FurnaceConfig = await ConfigUtil.getConfig(repoDir, templateRepoDir, stackName!, environment!, platform!);

    Build.buildStack(repoDir, templateRepoDir, buildBucket!, platform!);

    const processor = new Processor();
    processor.process(furnaceConfig, environment!, buildBucket!);
    
})();

