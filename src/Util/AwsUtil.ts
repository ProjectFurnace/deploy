import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { SecretsManager } from "aws-sdk";
import { Resource } from "../Model/Config";
import { FirehoseDeliveryStreamArgs } from "@pulumi/aws/kinesis";

export default class awsUtil {
    static createSimpleIamRole(name: string, action: string, service: string, effect: string) {
        return new aws.iam.Role(name, {
            assumeRolePolicy: JSON.stringify({
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Action": action,
                        "Principal": {
                            "Service": service,
                        },
                        "Effect": effect,
                        "Sid": "",
                    },
                ],
            })
        });
    }

    static createSimpleIamRolePolicy(name: string, roleId: pulumi.Output<string>, allows: Array<any>): aws.iam.RolePolicy {
        const def = {
            role: roleId,
            policy: JSON.stringify({
                "Version": "2012-10-17",
                "Statement": 
                    allows.map(allow => (
                    {
                        "Effect": "Allow",
                        "Action": allow.actions,
                        "Resource": allow.resource
                    }
                ))
            })
        };

        return new aws.iam.RolePolicy(name, def);
    }

    static runtimeFromString(runtime: string): aws.lambda.Runtime {
        switch (runtime) {
            case 'nodejs8.10':
                return aws.lambda.NodeJS8d10Runtime;
            case 'python3.7':
                return aws.lambda.Python3d6Runtime;
            default:
                throw new Error(`unsupported runtime ${runtime}`);
        }
    }

    static getSecret(name: string) {
        const params = {
          SecretId: name,
        };
      
        const sm = new SecretsManager({region: aws.config.region});
        return sm.getSecretValue(params).promise();
      }

    static async createResource(resourceName: string, type: string, config: any, stackName: string, environment: string): Promise<any> {
        switch (type) {
            case "elasticsearch.Domain":
                config.domainName = resourceName;
                return new aws.elasticsearch.Domain(resourceName, config)
            case "redshift.Cluster":
                config.clusterIdentifier = resourceName;

                const secretName = `${process.env.FURNACE_INSTANCE}/${stackName}-${config.masterPasswordSecret}-${environment}`;
                try {
                    const secret = await this.getSecret(secretName);

                    config.masterPassword = secret.SecretString;

                    return new aws.redshift.Cluster(resourceName, config)
                } catch(e) {
                    throw new Error(`unable to find secret ${secretName} specified in resource ${resourceName}`);
                }
            default:
                throw new Error(`unknown resource type ${type}`)
        }
    }

    static createFirehosePolicy(params: any[]) {
        let [ kinesisArn, bucketName, elasticArn ] = params;

        let policy = {
            Version: "2012-10-17",
            Statement: [
            {
              Effect: "Allow",
              Action: [
                "s3:AbortMultipartUpload",
                "s3:GetBucketLocation",
                "s3:GetObject",
                "s3:ListBucket",
                "s3:ListBucketMultipartUploads",
                "s3:PutObject"
              ],
              Resource: [
                  `arn:aws:s3:::${bucketName}/*` // policy refers to bucket name explicitly
              ]
            },
            { 
                Effect: "Allow",
                Resource: [ kinesisArn ],
                Action: [
                    "kinesis:DescribeStream",
                    "kinesis:GetShardIterator",
                    "kinesis:GetRecords"
                ]
            }]
        };

        if( elasticArn ) {
            policy.Statement.push({ 
                Effect: "Allow",
                Resource: [ elasticArn, elasticArn + "/*" ],
                Action: [
                    "es:DescribeElasticsearchDomain",
                    "es:DescribeElasticsearchDomains",
                    "es:DescribeElasticsearchDomainConfig",
                    "es:ESHttpGet",
                    "es:ESHttpPost",
                    "es:ESHttpPut"
                ]
            });
        }

        return JSON.stringify(policy);
    }

    static async createFirehose(resourceName: string, createdResource: any | undefined, config: any, source: aws.kinesis.Stream): Promise<aws.kinesis.FirehoseDeliveryStream> {

        const failureBucket = new aws.s3.Bucket(`${resourceName}-Bucket`, {});

        const role = this.createSimpleIamRole(`${resourceName}-Role`, "sts:AssumeRole", "firehose.amazonaws.com", "Allow");

        if (config.elasticsearchConfiguration) {
            if (!createdResource) throw new Error(`elasticsearch firehose expects a resource to be specified`);

            const esResource = createdResource as aws.elasticsearch.Domain;
            
            config.elasticsearchConfiguration.roleArn = role.arn
            config.elasticsearchConfiguration.domainArn = esResource.arn;
            
        } else if (config.redshiftConfiguration) {

            const redshiftResource = createdResource as aws.redshift.Cluster;

            const jdbcUrl = pulumi.all([ redshiftResource.endpoint, redshiftResource.databaseName ])
                .apply(([ endpoint, databaseName]) => (
                    `jdbc:redshift://${endpoint}/${databaseName || "unknown"}`
                ))

            config.redshiftConfiguration.clusterJdbcurl = jdbcUrl;
            config.redshiftConfiguration.roleArn = role.arn
            config.redshiftConfiguration.username = redshiftResource.masterUsername;
            config.redshiftConfiguration.password = redshiftResource.masterPassword;

        } else if (config.extendedS3Configuration) {
            
        } else if (config.splunkConfiguration) {
            
        }

        const def = {
            role: role.id,
            policy: pulumi.all([source.arn, failureBucket.bucket, (config.elasticsearchConfiguration ? config.elasticsearchConfiguration.domainArn : null)]).apply(this.createFirehosePolicy)
        };

        const policy = new aws.iam.RolePolicy(`${resourceName}-Policy`, def, {parent: role, dependsOn: [source]});

        let parameters: aws.kinesis.FirehoseDeliveryStreamArgs = {
            name: resourceName,
            kinesisSourceConfiguration: {
                kinesisStreamArn: source.arn,
                roleArn: role.arn,

            },
            destination: config.destination,
            s3Configuration: {
                bucketArn: failureBucket.arn,
                roleArn: role.arn
            },
            elasticsearchConfiguration: config.elasticsearchConfiguration,
            extendedS3Configuration: config.extendedS3Configuration,
            redshiftConfiguration: config.redshiftConfiguration,
            splunkConfiguration: config.splunkConfiguration
        }

        const firehose = new aws.kinesis.FirehoseDeliveryStream(resourceName, parameters);

        return firehose;
    }
}
