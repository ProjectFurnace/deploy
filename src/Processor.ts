import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import awsUtil from "./Util/AwsUtil";
import { FurnaceConfig, Module } from "./Model/Config"

export default class Processor {

    constructor(public config: FurnaceConfig, private environment: string) {

    }

    process() {
        const flows = this.getFlows();

        for(let flow of flows) {
            for (let step of flow) {
                const lambdaName = `${step.name}-${this.environment}`;
                const role = awsUtil.createSimpleIamRole(`${lambdaName}-FunctionRole`, "sts:AssumeRole", "lambda.amazonaws.com", "Allow");
                const policy = awsUtil.createSimpleIamRolePolicy(`${lambdaName}-FunctionPolicy`, role.id, [
                    { 
                        resource: "arn:aws:logs:*:*:*",
                        actions: [ "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents" ]
                    }
                ])

                let lambda = new aws.lambda.Function(lambdaName, {
                    name: lambdaName,
                    handler: "handler.handler",
                    role: role.arn,
                    runtime: aws.lambda.NodeJS8d10Runtime,
                    s3Bucket: "furnace-artifacts",
                    s3Key: "Test"
                });
            }
        }
    }

    getFlows(): Array<Array<Module>> {

        let flows: Array<any> = [];

        for (let pipe of this.config.pipes) {

            let flow: Array<any> = [];

            if (pipe.tap) {
                if (!pipe.pipeline) throw new Error("tap pipe must reference a pipeline");

                const tap = this.config.taps.find(taps => taps.name === pipe.tap);
                if (!tap) throw new Error(`unable to find tap ${pipe.tap} specified in pipe ${this.config.pipes.indexOf(pipe)}`)

                const pipeline = this.config.pipelines.find(pipeline => pipeline.name === pipe.pipeline);
                if (!pipeline) throw new Error(`unable to find pipeline ${pipe.pipeline} specified in pipe ${this.config.pipes.indexOf(pipe)}`)

                flow.push(tap);
                for (let m of pipeline.modules) {
                    flow.push(m);
                }

                //TODO: support multiple outputs, currently only sinks supported
                const outputPipe = this.config.pipes.find(pipe => (pipe.pipeline === pipeline.name) && pipe.sink != undefined);
                if (outputPipe) {
                    if (outputPipe.sink) {
                        const output = this.config.sinks.find(sink => sink.name === outputPipe.sink);
                        flow.push(output)
                    } else {
                        throw new Error(`unsupported output for pipeline ${pipe.pipeline}`)
                    }
                }

                flows.push(flow);
            }
        }

        return flows;
    }
}
