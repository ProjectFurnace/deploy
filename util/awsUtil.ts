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
        return new aws.iam.RolePolicy(`${name}PreParserRolePolicy`, {
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
}
