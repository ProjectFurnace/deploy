export function execPromise(command: string, options: any): Promise<any> {
  const exec = require("child_process").exec;

  return new Promise((resolve, reject) => {
      exec(command, options, (error: any, stdout: any, stderr: any) => {
          if (error) {
              reject(error);
              return;
          }
          resolve(stdout);
      });
  });
}