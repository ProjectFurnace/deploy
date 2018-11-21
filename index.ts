import Processor from "./src/Processor";
import ConfigUtil from "./src/Util/ConfigUtil";
import { FurnaceConfig } from "./src/Model/Config";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "@pulumi/pulumi";

let config = new Config("deploy");
let configPath: string = config.require("configPath");

const furnaceConfig: FurnaceConfig = ConfigUtil.getConfig(configPath);
const environment = pulumi.getStack().split("-").pop();

const processor = new Processor(furnaceConfig, environment as string);
processor.process();