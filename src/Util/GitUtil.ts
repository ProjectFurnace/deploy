const Git = require("simple-git/promise"); // using require to workaround ts type issue

export default class GitUtil {

    static async clone(path: string, url: string, username: string, token: string) {
        const git = Git(path);

        const fullUrl = (username && token) ? `${url.replace("://", "://" + username + ":" + token + "@")}` : url;
        await git.clone(fullUrl, ".");
    }

    static async checkout(path: string, tag: string) {
        const git = Git(path);
        await git.checkout(tag);
    }
}
