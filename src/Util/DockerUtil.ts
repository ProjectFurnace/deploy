
import { execPromise } from "../Util/ProcessUtil";
import { ECR } from "aws-sdk";
import * as aws from "@pulumi/aws";

export default class DockerUtil {
  constructor(private image: string, private buildPath: string, private tag: string = 'latest') {
  }

  async build(buildArgs:string) {
    //docker build -t project-furnace/base:latest --build-arg OUTPUT_CONNECTOR=@project-furnace/aws-kinesis-stream-connector --build-arg INPUT_CONNECTOR=@project-furnace/salesforce-connector .
    await execPromise(`docker build -t ${this.image}:${this.tag} ${buildArgs} .`, { cwd: this.buildPath, env: process.env });
  }

  async push(repoUrl:string) {
    //docker tag project-furnace/base:latest XXXXXXXXXX.dkr.ecr.eu-west-1.amazonaws.com/project-furnace/base:latest
    //docker push XXXXXXXXXX.dkr.ecr.eu-west-1.amazonaws.com/project-furnace/base:latest
    await execPromise(`docker tag ${this.image}:${this.tag} ${repoUrl}/${this.image}:${this.tag}`, { cwd: this.buildPath, env: process.env });
    await execPromise(`docker push ${repoUrl}/${this.image}:${this.tag}`, { cwd: this.buildPath, env: process.env });
  }

  async getOrCreateRepo(platform:string) {
    switch(platform) {
      case 'aws':
        const ecr = new ECR({region: aws.config.region});

        try {
          const repo_list = await ecr.describeRepositories({repositoryNames: [this.image]}).promise();

          if (repo_list.repositories) {
            return repo_list.repositories[0];
          } else {
            const repo = await ecr.createRepository({repositoryName: this.image}).promise();

            if (repo) {
              return repo.repository;
            } else {
              throw new Error('Repo creation failed')
            }
          }
        } catch(e) {
          if (e.code == 'RepositoryNotFoundException') {
            const repo = await ecr.createRepository({repositoryName: this.image}).promise();
  
            if (repo) {
              return repo.repository;
            } else {
              throw new Error('Repo creation failed')
            }
          } else {
            throw new Error(e);
          }
        }
        break;

      default:
        throw new Error('Platform not supported for repo creation');
    }
  }
}