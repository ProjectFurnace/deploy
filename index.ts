import * as gitUtils from "@project-furnace/gitutils";
import * as pulumi from "@pulumi/pulumi";
import * as tmp from "tmp";
import * as fsUtils from "@project-furnace/fsutils";
import Build from "./src/Build";
import * as path from "path";
import { Processor as StackProcessor } from "@project-furnace/stack-processor";
import AwsFlowProcessor from "./src/AwsFlowProcessor";
import { RegisteredResource } from "./src/Types";
import * as _ from "lodash";
import { BuildSpec } from "@project-furnace/stack-processor/src/Model";

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
            if (!gitRemote) throw new Error(`GIT_REMOTE not set`);
            if (!gitTag) throw new Error(`GIT_TAG not set`);
            // if (!gitUsername) throw new Error(`GIT_USERNAME not set`);
            // if (!gitToken) throw new Error(`GIT_TOKEN not set`);

            //TODO: check AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY if platform is aws
            
            await gitUtils.clone(templateRepoDir, templateRepoRemote, gitUsername!, gitToken!);
        } else console.log("executing local mode...")

        const processor = new StackProcessor(repoDir, templateRepoDir);

        const config = processor.getConfig()
            , flows = await processor.getFlowsWithBuildSpec(environment!, platform)
            ;

        dumpFlows(flows);
        // Build.buildStack(repoDir, templateRepoDir, buildBucket!, platform!);

        const platformType = "aws"; //this.config.stack!.platform!.type

        console.log(`deploying stack '${config.stack.name}' in env '${environment}' for platform '${platform}'`)

        switch (platformType) {
            case "aws":
                const awsFlowProcessor = new AwsFlowProcessor(flows, config.stack, environment!, buildBucket!);
                const resources = await awsFlowProcessor.process();
                // dumpResources(resources);
                break;
            default:
                throw new Error("unknown stack platform type");
        }
})();

function dumpFlows(flows: BuildSpec[]) {
    let currentType = null;

    const sorted = _.orderBy(flows, "component");

    for (let flow of flows) {
        if (currentType !== flow.component) {
            console.log(flow.component);
            currentType = flow.component;
        }
        console.log(`  ${flow.meta!.identifier} <- ${flow.meta!.source}`);
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