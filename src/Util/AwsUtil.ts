import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

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

    static createResource(name: string, type: string, config: any) {
        config.name = name;

        switch (type) {
            case "elasticsearch.Domain":
                new aws.elasticsearch.Domain(name, config);
                break;
            default:
                throw new Error(`unknown resource type ${type}`)
        }
    }
}
