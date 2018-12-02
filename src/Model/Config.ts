export type FurnaceConfig = {
    sources: Array<Source>
    taps: Array<Tap>
    pipelines: Array<Pipeline>
    sinks: Array<Sink>
    pipes: Array<Pipe>
    stack: Stack
    [key: string]: any // allows us to reference items by key
}

export type ModuleSpec = {
    name: string
    module: string
    runtime: string
    config: ModuleConfig
    parameters: Map<string, string>
    meta: {
        hash?: string
        moduleHash?: string
        templateHash?: string
        source?: string
        function?: string
        output?: string
        
    }
}

export type ModuleConfig = {
    aws?: any
    [key: string]: any
}

export type Source = {
    name: string
    type: SourceType
    perEnvironment: boolean
    initialize: boolean
    config: any
}

export type Tap = ModuleSpec & {
    source: string
}

export type Pipeline = {
    name: string
    modules: Array<PipelineModule>
}

export type PipelineModule = ModuleSpec

export type Sink = ModuleSpec

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
        type: string
        aws?: StackAws
        build : {
            bucket: string
        }
    }
    state: {
        repo: string
    }
}

export type StackAws = {
    region?: string
    defaultBatchSize?: number
    defaultStartingPosition?: string
}

export enum SourceType {
    AwsKinesisStream= "KinesisStream",
    KafkaStream="KafkaStream"
}