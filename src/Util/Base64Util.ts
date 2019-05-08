export default class Base64Util {
  static toBase64(input: string): string {
    const buf = Buffer.from(input, "ascii");
    return buf.toString("base64");
  }

  static fromBase64(input: string): string {
    return Buffer.from(input, "base64").toString();
  }
}