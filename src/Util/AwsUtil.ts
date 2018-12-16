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
        return new aws.iam.RolePolicy(name, {
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
        });
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

        if (config.elasticsearchConfiguration) {
            if (!resourceArn) throw new Error(`elasticsearch firehose expects a resource to be specified`);
            
            config.elasticsearchConfiguration.roleArn = ""
            config.elasticsearchConfiguration.domainArn = resourceArn

        } else if (config.extendedS3Configuration) {
            
        } else if (config.redshiftConfiguration) {
            
        } else if (config.splunkConfiguration) {
            
        }

        let parameters: aws.kinesis.FirehoseDeliveryStreamArgs = {
            name: resourceName,
            kinesisSourceConfiguration: {
                kinesisStreamArn: source.arn,
                roleArn: "",

            },
            destination: config.destination,
            elasticsearchConfiguration: config.elasticsearchConfiguration,
            extendedS3Configuration: config.extendedS3Configuration,
            redshiftConfiguration: config.redshiftConfiguration,
            splunkConfiguration: config.splunkConfiguration
        }

        const firehose = new aws.kinesis.FirehoseDeliveryStream(resourceName, parameters);

        return firehose;
    }
}
