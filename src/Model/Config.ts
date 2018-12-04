export type FurnaceConfig = {
    taps: Array<Tap>
    pipelines: Array<Pipeline>
    sinks: Array<Sink>
    pipes: Array<Pipe>
    stack: Stack
    [key: string]: any; // allows us to reference items by key
}

export type Module = {
    name: string
    module: string,
    config: any
    aws: any
}

export type Tap = Module

export type Pipeline = {
    name: string
    modules: Array<PipelineModule>
}

export type PipelineModule = Module

export type Sink = Module

export type Pipe = {
    tap?: string
    pipeline?: string
    sink?: string
}

export type Stack = {
    platform: {
        type: string
        artifactBucket: string
    }
    state: {
        repo: string
    }
}