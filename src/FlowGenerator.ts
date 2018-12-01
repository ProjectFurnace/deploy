import { FurnaceConfig, ModuleSpec, Tap } from "./Model/Config";

export default class FlowGenerator {



    static getFlows(config: FurnaceConfig, environment: string): Array<Array<ModuleSpec>> {

        let flows: Array<Array<ModuleSpec>> = [];

        for (let pipe of config.pipes) {

            let flow: Array<ModuleSpec> = [];

            if (pipe.tap) {
                if (!pipe.pipeline) throw new Error("tap pipe must reference a pipeline");

                const tap = config.taps.find(taps => taps.name === pipe.tap) as Tap;
                if (!tap) throw new Error(`unable to find tap ${pipe.tap} specified in pipe ${config.pipes.indexOf(pipe)}`)

                const source = config.sources.find(sources => sources.name === tap.source);
                if (!source) throw new Error(`tap ${tap.name} references source ${tap.source} that was not found`);

                let tapSource = source.config.stream || source.name;
                if (source.perEnvironment) tapSource = `${tapSource}-${environment}`; // append the environment

                tap.meta.source = tapSource;
                tap.meta.function = `${tap.name}-${environment}`;

                const pipeline = config.pipelines.find(pipeline => pipeline.name === pipe.pipeline);
                if (!pipeline) throw new Error(`unable to find pipeline ${pipe.pipeline} specified in pipe ${config.pipes.indexOf(pipe)}`)
                if (pipeline.modules.length === 0) throw new Error(`pipeline ${pipe.pipeline} contains no module definitions`);
                
                flow.push(tap);
                for (let m = 0; m < pipeline.modules.length; m++) {
                    const mod = pipeline.modules[m];
                    
                    mod.meta.source = (m === 0 ? tap.name : pipeline.modules[m -1].name) + `-${environment}-out`;
                    mod.meta.function = `${mod.name}-${environment}`;

                    flow.push(mod);
                }

                //TODO: support multiple outputs, currently only sinks supported
                const outputPipe = config.pipes.find(pipe => (pipe.pipeline === pipeline.name) && pipe.sink != undefined);
                if (outputPipe) {
                    if (outputPipe.sink) {
                        const output = config.sinks.find(sink => sink.name === outputPipe.sink) as ModuleSpec;
                        output.meta.source = pipeline.modules[pipeline.modules.length -1].name + `-${environment}-out`;
                        output.meta.function = `${output.name}-${environment}`;
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