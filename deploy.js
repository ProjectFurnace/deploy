const gitUtils = require('@project-furnace/gitutils');
const fsUtils = require('@project-furnace/fsutils');

(async () => {
    const gitRemote = process.env.GIT_REMOTE
        , gitToken = process.env.GIT_TOKEN
        , gitUsername = process.env.GIT_USERNAME
        , repoDir = "/tmp/stack/"
        ;

    if (!gitRemote) throw new Error(`GIT_REMOTE not set`);
    if (!gitUsername) throw new Error(`GIT_USERNAME not set`);
    if (!gitToken) throw new Error(`GIT_TOKEN not set`);

    if (!fsUtils.exists(repoDir)) fsUtils.mkdir(repoDir);

    await gitUtils.clone(repoDir, gitRemote, gitUsername, gitToken);

    console.log(repoDir);
})();

