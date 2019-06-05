const gitUtils = require('@project-furnace/gitutils');
const fsUtils = require('@project-furnace/fsutils');

(async () => {
    const gitRemote = process.env.GIT_REMOTE
        , gitToken = process.env.GIT_TOKEN
        , gitUsername = process.env.GIT_USERNAME
        , gitTag = process.env.GIT_TAG
        , repoDir = "/tmp/stack/"
        ;

    try {
    if (!gitRemote) throw new Error(`GIT_REMOTE not set`);
        if (!gitUsername) throw new Error(`GIT_USERNAME not set`);
        if (!gitToken) throw new Error(`GIT_TOKEN not set`);

        if (!fsUtils.exists(repoDir)) fsUtils.mkdir(repoDir);

        await gitUtils.clone(repoDir, gitRemote, gitUsername, gitToken);
        await gitUtils.checkout(repoDir, gitTag);

        console.log(repoDir);
    } catch (e) {
        console.log(e.message);
        process.exit(1);
    }
})();

