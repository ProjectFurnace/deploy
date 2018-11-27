const { hashElement } = require("folder-hash");

export default class HashUtil {
    static async getDirectoryHash(dir: string) {
        const options = { encoding: "hex", folders: { ignoreRootName: true } }

        const result = await hashElement(dir, options);
    
        return result.hash;
    }
}