const gitUtils = require('@project-furnace/gitutils');
const tmp = require('tmp');

(async () => {
    const gitRemote = process.env.GIT_REMOTE // "https://github.com/ProjectFurnace/dev-stack"
        , gitToken = process.env.GIT_TOKEN
        , repoDir = tmp.dirSync().name
        ;

    if (!gitRemote) throw new Error(`GIT_REMOTE not set`);
    if (!gitUsername) throw new Error(`GIT_USERNAME not set`);
    if (!gitToken) throw new Error(`GIT_TOKEN not set`);

    await gitUtils.clone(repoDir, gitRemote, gitUsername, gitToken);

    console.log(repoDir);
})();

