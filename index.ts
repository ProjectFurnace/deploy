import * as gitUtils from "@project-furnace/gitutils";
import * as pulumi from "@pulumi/pulumi";
import * as tmp from "tmp";
import * as os from "os";
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
    , stackRepoDir = process.env.REPO_DIR || "/tmp/stack/"
    , functionsDir = path.join(stackRepoDir, "src")
    , templateRepoRemote = "https://github.com/ProjectFurnace/function-templates"
    , templateRepoDir = process.env.TEMPLATE_REPO_DIR || tmp.dirSync().name
    , isLocal = process.env.FURNACE_LOCAL ? true : false
    ;

    if (!platform) throw new Error(`PLATFORM not set`);
    if (!buildBucket) throw new Error(`BUILD_BUCKET not set`);
    if (!environment) throw new Error(`unable to extract environment`);
    // not really required anymore - functions may all be in repos
    //if (!fsUtils.exists(functionsDir)) throw new Error(`stack must have a functions 'src' directory`);

    if (!isLocal) {
        console.log("pulling templates...");
        await gitUtils.clone(templateRepoDir, templateRepoRemote, gitUsername!, gitToken!);
        if (process.env.FN_TEMPLATES_TAG) {
            await gitUtils.checkout(templateRepoDir, process.env.FN_TEMPLATES_TAG);
        }
    } else {
        console.log("executing local mode...");
    }

    const processor = new StackProcessor(stackRepoDir, templateRepoDir);

    const stackRepos = processor.getStackRepos();

    // Clone repos found in the stack yaml definition
    let reposCacheDir = "";
    if (stackRepos) {
        reposCacheDir = fsUtils.createTempDirectory();
        processor.setRepoCachePath(reposCacheDir);

        // if we're running from local, check if we have a .furnace/repo folder
        const workspaceReposDir = isLocal ? path.join(os.homedir(), ".furnace", "repo") : "";

        // loop through all repos defined in stack.yaml
        for (const repo of stackRepos) {
            if (!repo.name || !repo.url) {
                throw new Error("Repositories must have both a name and a URL defined");
            }

            // check if we have a folder in the cache for that org and repo, and if not, create it
            const currentRepoCacheDir = path.join(reposCacheDir, repo.bits.org, repo.bits.repo);
            if (!fsUtils.exists(currentRepoCacheDir)) {
                const currentRepoOrgCacheDir = path.join(reposCacheDir, repo.bits.org);
                if (!fsUtils.exists(currentRepoOrgCacheDir)) {
                    fsUtils.mkdir(currentRepoOrgCacheDir);
                }
                fsUtils.mkdir(currentRepoCacheDir);
            }

            // if we are running in local mode and there's a .furnace/repo folder
            // check if we have a folder for the current repo if we don't, clone it.
            // In any case, move that then to the cache folder
            // TODO: Version bits for repos
            if (workspaceReposDir !== "" && fsUtils.exists(workspaceReposDir)) {
                const workspaceRepoPath = path.join(workspaceReposDir, repo.bits.org, repo.bits.repo);
                const workspaceOrgPath = path.join(workspaceReposDir, repo.bits.org);
                if (!fsUtils.exists(workspaceRepoPath)) {
                    // if org dir does not exist, create it
                    if (!fsUtils.exists(workspaceOrgPath)) {
                        fsUtils.mkdir(workspaceOrgPath);
                    }
                    if (!fsUtils.exists(workspaceRepoPath)) {
                        fsUtils.mkdir(workspaceRepoPath);
                    }
                    console.log(`Clonning ${repo.name} repo...`);
                    await gitUtils.clone(workspaceRepoPath, repo.url, "", "");
                }
                fsUtils.cp(workspaceRepoPath, currentRepoCacheDir);
            } else {
                console.log(`Clonning ${repo.name} repo...`);
                await gitUtils.clone(currentRepoCacheDir, repo.url, "", "");
            }
        }
    }

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
        stackRepoDir,
        templateRepoDir,
        reposCacheDir,
        );

    await platformProcessor.preProcess();

    const resources = await platformProcessor.process();
    // dumpResources(resources);
})();

function dumpFlows(flows: BuildSpec[]) {
    let currentType = null;

    const sorted = _.orderBy(flows, "component");

    for (let flow of flows) {
        if (currentType !== flow.construct) {
            console.log(flow.construct);
            currentType = flow.construct;
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