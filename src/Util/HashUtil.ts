import BigNumber from 'bignumber.js';
const { hashElement } = require('folder-hash');

export default class HashUtil {
  static async getDirectoryHash(dir: string) {
    const options = { encoding: 'hex', folders: { ignoreRootName: true } };

    const result = await hashElement(dir, options);

    return result.hash;
  }

  static combineHashes(hash1: string, hash2: string): string {
    return new BigNumber('0x' + hash1)
      .plus(new BigNumber('0x' + hash2))
      .toString(16);
  }
}
