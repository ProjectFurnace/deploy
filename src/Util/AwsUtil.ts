import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Resource } from "../Model/Config";

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
            case "nodejs8.10":
                return aws.lambda.NodeJS8d10Runtime;
            default:
                throw new Error(`unsupported runtime ${runtime}`);
        }
    }

    static createResource(resourceName: string, type: string, config: any): pulumi.Output<string> {

        switch (type) {
            case "elasticsearch":
                config.domainName = resourceName;
                return new aws.elasticsearch.Domain(resourceName, config).arn;
            default:
                throw new Error(`unknown resource type ${type}`)
        }

    }

    static createFirehose(resourceName: string, resourceArn: pulumi.Output<string> | undefined, config: any, source: aws.kinesis.Stream): aws.kinesis.FirehoseDeliveryStream {

        const failureBucket = new aws.s3.Bucket(`${resourceName}-Bucket`, {});

        const role = this.createSimpleIamRole(`${resourceName}-Role`, "sts:AssumeRole", "firehose.amazonaws.com", "Allow");
        const policy = this.createSimpleIamRolePolicy(`${resourceName}-Policy`, role.id, [
            { 
                resource: "*",
                actions: [
                    "s3:AbortMultipartUpload",
                    "s3:GetBucketLocation",
                    "s3:GetObject",
                    "s3:ListBucket",
                    "s3:ListBucketMultipartUploads",
                    "s3:PutObject"
                  ]
            },
            { 
                resource: "*",
                actions: [
                    "kinesis:DescribeStream",
                    "kinesis:GetShardIterator",
                    "kinesis:GetRecords"
                ]
            },
            { 
                resource: "*",
                actions: [
                    "es:DescribeElasticsearchDomain",
                    "es:DescribeElasticsearchDomains",
                    "es:DescribeElasticsearchDomainConfig",
                    "es:ESHttpGet",
                    "es:ESHttpPost",
                    "es:ESHttpPut",
                    "es:ESHttpHead",
                    "es:ListDomainNames",
                ]
            }
        ]);

        if (config.elasticsearchConfiguration) {
            if (!resourceArn) throw new Error(`elasticsearch firehose expects a resource to be specified`);
            
            config.elasticsearchConfiguration.roleArn = role.arn
            config.elasticsearchConfiguration.domainArn = resourceArn

        } else if (config.extendedS3Configuration) {
            
        } else if (config.redshiftConfiguration) {
            
        } else if (config.splunkConfiguration) {
            
        }

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
