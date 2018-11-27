export type FurnaceConfig = {
    taps: Array<Tap>
    pipelines: Array<Pipeline>
    sinks: Array<Sink>
    pipes: Array<Pipe>
    stack: Stack
    [key: string]: any; // allows us to reference items by key
}

export type ModuleSpec = {
    name: string
    module: string
    config: ModuleConfig
    meta: {
        hash?: string
    }
}

export type ModuleConfig = {
    config: any
    aws?: any
}

export type Tap = ModuleSpec

export type Pipeline = {
    name: string
    modules: Array<PipelineModule>
}

export type PipelineModule = ModuleSpec

export type Sink = ModuleSpec

export type Pipe = {
    tap?: string
    pipeline?: string
    sink?: string
}

export type Stack = {
    platform: {
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

