import * as gitUtils from "@project-furnace/gitutils";
import * as pulumi from "@pulumi/pulumi";
import * as tmp from "tmp";
import * as fsUtils from "@project-furnace/fsutils";
import * as path from "path";
import { Processor as StackProcessor } from "@project-furnace/stack-processor";
import { RegisteredResource } from "./src/Types";
import * as _ from "lodash";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";
import PlatformProcessorFactory from "./src/PlatformProcessorFactory";

(async () => {
      let gitRemote = process.env.GIT_REMOTE
        , gitTag = process.env.GIT_TAG
        , gitUsername = process.env.GIT_USERNAME
        , gitToken = process.env.GIT_TOKEN
        , buildBucket = process.env.BUILD_BUCKET
        , environment = process.env.ENVIRONMENT || pulumi.getStack().split("-").pop()
        , platform = process.env.PLATFORM
        , repoDir = process.env.REPO_DIR || "/tmp/stack/"
        , modulesDir = path.join(repoDir, "modules")
        , templateRepoRemote = "https://github.com/ProjectFurnace/function-templates"
        , templateRepoDir = process.env.TEMPLATE_REPO_DIR || tmp.dirSync().name
        , isLocal = process.env.FURNACE_LOCAL ? true : false
        ;

        if (!platform) throw new Error(`PLATFORM not set`);
        if (!buildBucket) throw new Error(`BUILD_BUCKET not set`);
        if (!environment) throw new Error(`unable to extract environment`);
        if (!fsUtils.exists(modulesDir)) throw new Error(`stack must have a modules directory`);

        if (!isLocal) {
            console.log("pulling templates...")
            await gitUtils.clone(templateRepoDir, templateRepoRemote, gitUsername!, gitToken!);
        } else console.log("executing local mode...");

        const processor = new StackProcessor(repoDir, templateRepoDir);

        const config = processor.getConfig()
            , flows = await processor.getFlowsWithBuildSpec(environment!, platform)
            ;

        // dumpFlows(flows);
        // Build.buildStack(repoDir, templateRepoDir, buildBucket!, platform!);

        console.log(`deploying stack '${config.stack.name}' in env '${environment}' for platform '${platform}'`)

        const platformProcessor = await PlatformProcessorFactory.getProcessor(
            platform, 
            flows, 
            config.stack, 
            environment, 
            buildBucket, 
            repoDir, 
            templateRepoDir
            );

        await platformProcessor.preProcess();

        const resources = await platformProcessor.process();
        // dumpResources(resources);
})();

function dumpFlows(flows: BuildSpec[]) {
    let currentType = null;

    const sorted = _.orderBy(flows, "component");

    for (let flow of flows) {
        if (currentType !== flow.component) {
            console.log(flow.component);
            currentType = flow.component;
        }
        console.log(`  ${flow.meta!.identifier} <- ${flow.meta!.sources}`);
    }
}

function dumpResources(resources: RegisteredResource[]) {
    let currentType = null;

    const sorted = _.orderBy(resources, "type");

    for (let resource of resources) {
        if (currentType !== resource.type) {
            console.log(resource.type);
            currentType = resource.type;
        }
        console.log(`  ${resource.name}`);
    }
}