import { FurnaceConfig, FlowSpec, Tap, Sink, SourceType, SinkType } from "./Model/Config";

export default class FlowGenerator {

    static getFlows(config: FurnaceConfig, environment: string): Array<Array<FlowSpec>> {

        let flows: Array<Array<FlowSpec>> = [];

        const stackName = config.stack.name;

        //TODO: should process sources here also to be consistant

        for (let pipe of config.pipes) {

            let flow: Array<FlowSpec> = [];

            if (pipe.tap) {
                if (!pipe.pipeline) throw new Error("tap pipe must reference a pipeline");

                const tap = config.taps.find(taps => taps.name === pipe.tap) as Tap;
                if (!tap) throw new Error(`unable to find tap ${pipe.tap} specified in pipe ${config.pipes.indexOf(pipe)}`)

                const source = config.sources.find(sources => sources.name === tap.source);
                if (!source) throw new Error(`tap ${tap.name} references source ${tap.source} that was not found`);

                let tapSource = `${stackName}-${(source.config && source.config.stream ) ? source.config.stream : source.name}-${environment}`;

                tap.component = "tap";
                tap.meta.source = tapSource;
                tap.meta.identifier = `${stackName}-${tap.name}-${environment}`;
                tap.meta.output = `${stackName}-${tap.meta.output}`;

                const pipeline = config.pipelines.find(pipeline => pipeline.name === pipe.pipeline);
                if (!pipeline) throw new Error(`unable to find pipeline ${pipe.pipeline} specified in pipe ${config.pipes.indexOf(pipe)}`)
                if (pipeline.modules.length === 0) throw new Error(`pipeline ${pipe.pipeline} contains no module definitions`);
                
                flow.push(tap);
                for (let m = 0; m < pipeline.modules.length; m++) {
                    const mod = pipeline.modules[m];
                    
                    mod.component = "pipeline";
                    mod.meta.source = (m === 0 ? `${stackName}-${tap.name}-${environment}-out` : `${stackName}-${pipeline.modules[m -1].name}-${environment}-out`);
                    mod.meta.identifier = `${stackName}-${mod.name}-${environment}`;
                    mod.meta.output = `${stackName}-${mod.meta.output}`;

                    flow.push(mod);
                }

                //TODO: support multiple outputs, currently only sinks supported
                const outputPipes = config.pipes.filter(pipe => (pipe.pipeline === pipeline.name) && pipe.sink != undefined);
                
                for (let outputPipe of outputPipes) {
                    if (outputPipe.sink) {
                        const output = config.sinks.find(sink => sink.name === outputPipe.sink) as Sink;
                        if (!output) throw new Error(`unable to find sink ${outputPipe.sink} specified in pipe`)
                        
                        output.component = "sink";
                        output.meta.source = `${stackName}-${pipeline.modules[pipeline.modules.length -1].name}-${environment}-out`;
                        
                        if (!output.type) output.type = SinkType.Module; // default to module
                        output.meta.identifier = `${stackName}-${output.name}-${environment}`;
                        
                        flow.push(output)
                    } else {
                        throw new Error(`unsupported output for pipeline ${pipe.pipeline}`);
                    }
                }

                flows.push(flow);
            }
        }

        return flows;
    }

    static objectToFlow(obj: any) {
        const v = Object.values(obj);
        return {
            source: v[0],
            destination: v[1] 
        }
    }
}