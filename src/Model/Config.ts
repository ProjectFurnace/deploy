export type FurnaceConfig = {
    sources: Array<Source>
    taps: Array<Tap>
    pipelines: Array<Pipeline>
    sinks: Array<Sink>
    pipes: Array<Pipe>
    stack: Stack
    resources: Array<Resource>
    [key: string]: any // allows us to reference items by key
}

export type FlowSpec = {
    name: string
    component: string
    module?: string
    runtime?: string
    resource?: string
    config: ModuleConfig
    parameters: Map<string, string>
    inputs: Array<string>
    meta: {
        hash?: string
        moduleHash?: string
        templateHash?: string
        source?: string
        identifier?: string
        output?: string
    }
    type?: any
}

export type ModuleConfig = {
    aws?: any
    [key: string]: any
}

export type Source = {
    name: string
    type: SourceType
    initialize: boolean
    config: any
}

export type Tap = FlowSpec & {
    source: string
}

export type Pipeline = {
    name: string
    modules: Array<PipelineModule>
}

export type PipelineModule = FlowSpec

export type Sink = FlowSpec & {
    type?: SinkType
    resource?: string
}

export enum SinkType {
    Module="Module",
    AwsFirehose="AwsFirehose"
}

export type Pipe = {
    source?: string
    tap?: string
    pipeline?: string
    sink?: string
    [key: string]: any;
}

export type Stack = {
    name: string
    platform: {
        aws?: StackAws
    }
    state: {
        repo: string
    }
}

export type StackAws = {
    defaultBatchSize?: number
    defaultStartingPosition?: string
}

export enum SourceType {
    AwsKinesisStream= "KinesisStream",
    KafkaStream="KafkaStream"
}

export type Resource = {
    name: string
    type: string
    config: any
}