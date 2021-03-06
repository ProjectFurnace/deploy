import * as pulumi from "@pulumi/pulumi";
import * as _ from "lodash";
import { PlatformProcessor } from "../IPlatformProcessor";
import AwsUtil from "../Util/AwsUtil";
import { RegisteredResource, ResourceConfig } from "../Types";
import Base64Util from "../Util/Base64Util";
import VarUtil from "../Util/VarUtil";

export default class ResourceUtil {
  public static getRoutingDefinitions(flows: any, platform: string): any[] {
    const routingDefs: any = [];

    const routingComponents = flows.filter((flow: any) =>
      ["source", "tap", "pipeline-function"].includes(flow.construct)
    );

    // TODO: looks like there is room for improvement on this code
    for (const component of routingComponents) {
      if (component.construct === "source") {
        const existing = routingDefs.find(
          (r: any) => r.name === component.meta!.identifier
        );
        if (!existing) {
          routingDefs.push(
            ResourceUtil.createRoutingComponentDefinition(
              component,
              component.meta!.identifier,
              platform
            )
          );
        }
      } else {
        if (component.meta!.output) {
          const existing = routingDefs.find(
            (r: any) => r.name === component.meta!.output
          );
          if (!existing) {
            const outputComponent = routingComponents.find((r: any) =>
              r.meta!.sources.includes(component.meta!.output)
            );
            routingDefs.push(
              ResourceUtil.createRoutingComponentDefinition(
                outputComponent,
                component.meta!.output!,
                platform
              )
            );
          }
        }
        for (const source of component.meta!.sources!) {
          const existing = routingDefs.find((r: any) => r.name === source);
          if (!existing) {
            const sourceComponent = routingComponents.find(
              (r: any) => r.meta!.identifier === source
            );
            routingDefs.push(
              ResourceUtil.createRoutingComponentDefinition(
                sourceComponent,
                source!,
                platform
              )
            );
          }
        }
      }
    }
    return routingDefs;
  }

  static createRoutingComponentDefinition(
    component: any,
    name: string,
    platform: string
  ) {
    const componentConfig = (component && component.config) || {};
    const platformConfig =
      (component && component.config && component.config[platform]) || {};
    Object.assign(componentConfig, platformConfig);

    return {
      config: _.cloneDeep(componentConfig),
      mechanism: component && component.type ? component.type : undefined,
      name: name!,
      component,
    };
  }

  public static injectInName(name: string, inject: string): string {
    const nameBits = ResourceUtil.getBits(name);

    let rulename = name + "-" + inject;
    if (nameBits) {
      rulename = `${nameBits[1]}-${nameBits[2]}-${inject}-${nameBits[3]}`;
    }
    return rulename;
  }

  public static flattenResourceArray(
    resources: RegisteredResource[][]
  ): RegisteredResource[] {
    return [...([] as RegisteredResource[]).concat(...resources)];
  }

  public static getBits(name: string): any {
    const REGEX = /(\w+)-([\w_-]+)-(\w+)/;
    return REGEX.exec(name);
  }

  private static findResourceOrConfigByName(name: string, items: any[]) {
    if (items.length > 0) {
      return items.find((item) => item.name === name);
    }
    return false;
  }

  public global: any = {};

  constructor(
    private processor: PlatformProcessor,
    private stackName: string,
    private environment: string
  ) {}

  public setGlobal(global: any) {
    this.global = global;
  }

  public configure(
    name: string,
    type: string,
    config: any,
    scope: string,
    dependencies: string[] = [],
    outputs: any = {}
  ): ResourceConfig {
    const propertiesWithVars = VarUtil.process(config, scope);

    config.name = name;

    return {
      config,
      dependencies,
      name,
      outputs,
      propertiesWithVars,
      scope,
      type,
    };
  }

  public async register(
    config: ResourceConfig,
    registeredResources: RegisteredResource[] = []
  ) {
    try {
      const provider = this.processor.getResource(config);
      const newConfig = _.cloneDeep(config.config);

      const dependencies = [];
      // iterate over properties that are binded to other objects and create the necessary links in pulumi
      if (
        Array.isArray(config.propertiesWithVars) &&
        config.propertiesWithVars.length > 0
      ) {
        for (const propertyWithVars of config.propertiesWithVars) {
          const toConcat = [];
          let isObjectBind = false;
          for (const fragment of propertyWithVars.varParts) {
            if (VarUtil.isObject(fragment)) {
              if (fragment.scope === "global") {
                toConcat.push(
                  _.get(
                    this.global[fragment.resource],
                    fragment.bindTo,
                    fragment.default
                  )
                );
              } else if (fragment.resource === "secret") {
                // WARNING: bug fixed here, change above if from fragment.scope to fragment.resource, unable to work out if that was the intention

                const secretName = `/${process.env.FURNACE_INSTANCE}/${this.stackName}/${this.environment}/${fragment.bindTo}`; // changed last part to fragment.bindTo from fragment.resource, see above

                try {
                  const secret = await AwsUtil.getSecretSM(secretName);
                  toConcat.push(secret);
                } catch (e) {
                  throw new Error(
                    `Secret ${fragment.resource} not found! Please make sure to add the secret with the CLI first`
                  );
                }
              } else {
                // construct fragmentResource based on scope
                const fragmentResource =
                  fragment.scope === "resource"
                    ? fragment.resource
                    : fragment.scope + "_" + fragment.resource;
                const dependencyName = `${this.stackName}-${fragmentResource}-${this.environment}`;
                const resource = ResourceUtil.findResourceOrConfigByName(
                  dependencyName,
                  registeredResources
                );
                if (!resource) {
                  throw new Error(
                    `Dependency resource: ${fragmentResource} not found`
                  );
                } else {
                  // add this resource as a dependency
                  dependencies.push(resource.resource);
                  if (fragment.bindTo) {
                    toConcat.push(
                      _.get(
                        resource.resource,
                        fragment.bindTo,
                        fragment.default
                      )
                    );
                  } else {
                    isObjectBind = true;
                  }
                }
              }
            } else {
              toConcat.push(fragment);
            }
          }
          // if we are binding to a whole resource
          if (propertyWithVars.varParts.length > 1 && isObjectBind) {
            throw new Error(
              `Cannot bind to full resource while using constant prefixes or suffixes at: ${config.name} [${propertyWithVars.property}]`
            );
          } else if (isObjectBind) {
            _.set(newConfig, propertyWithVars.property, dependencies[0]);
          } else {
            if (
              (typeof toConcat[0] === "string" ||
                toConcat[0] instanceof String) &&
              toConcat[0].startsWith("base64::")
            ) {
              toConcat[0] = toConcat[0].substring(8);
              _.set(
                newConfig,
                propertyWithVars.property,
                pulumi
                  .all(toConcat)
                  .apply((toConcat) => Base64Util.toBase64(toConcat.join("")))
              );
            } else {
              _.set(
                newConfig,
                propertyWithVars.property,
                pulumi.concat(...toConcat)
              );
            }
          }
        }
      }

      if (
        Array.isArray(config.dependencies) &&
        config.dependencies.length > 0
      ) {
        for (const dependency of config.dependencies) {
          const dependencyName = `${this.stackName}-${dependency}-${this.environment}`;
          const resource = ResourceUtil.findResourceOrConfigByName(
            dependencyName,
            registeredResources
          );
          if (resource) {
            dependencies.push(resource.resource);
          }
        }
      }

      const instance = new provider(config.name, newConfig, {
        dependsOn: dependencies,
      }) as pulumi.CustomResource;

      if (config.outputs) {
        this.processor.processOutputs(config.name, instance, config.outputs);
      }

      return {
        name: config.name,
        resource: instance,
        type: config.type,
      };
    } catch (err) {
      throw new Error(
        `Unable to create resource ${config.name} of type ${config.type}: ${err}`
      );
    }
  }

  public async batchRegister(
    configs: ResourceConfig[],
    existingResources: RegisteredResource[] = [],
    callingResource: string = ""
  ) {
    let registeredResources: RegisteredResource[] = existingResources;

    for (const config of configs) {
      // check and register reference created dependencies
      if (
        Array.isArray(config.propertiesWithVars) &&
        config.propertiesWithVars.length > 0
      ) {
        // if we do, create an array with all resources this item depends on
        const dependencies = [];
        for (const propertyWithVars of config.propertiesWithVars) {
          // check if the dependency is same as the one that called us and if so, throw and error as we
          // have a circular dependency issue
          for (const fragment of propertyWithVars.varParts) {
            if (VarUtil.isObject(fragment)) {
              if (callingResource && fragment.resource === callingResource) {
                throw new Error(
                  `Circular dependency error: ${callingResource} and ${fragment.resource} depend each on the other`
                );
              }
              dependencies.push(fragment.resource);
            }
          }
        }
        await this.registerDependencies(
          config.name,
          dependencies,
          configs,
          registeredResources
        );
      }
      // register user specified dependencies
      if (
        Array.isArray(config.dependencies) &&
        config.dependencies.length > 0
      ) {
        for (const dependency of config.dependencies) {
          if (callingResource && dependency === callingResource) {
            throw new Error(
              `Circular dependency error: ${callingResource} and ${dependency} depend each on the other`
            );
          }
        }
        await this.registerDependencies(
          config.name,
          config.dependencies,
          configs,
          registeredResources
        );
      }
      // finally register the pertinent resource unless it has already been registered previously
      if (
        !ResourceUtil.findResourceOrConfigByName(
          config.name,
          registeredResources
        )
      ) {
        registeredResources.push(
          await this.register(config, registeredResources)
        );
      }
    }
    return registeredResources;
  }

  async registerDependencies(
    name: string,
    dependencies: any,
    configs: ResourceConfig[],
    registeredResources: RegisteredResource[]
  ) {
    // check if all those dependencies are already registered
    const pendingRegistrationResources = [];
    for (const dependency of dependencies) {
      const dependencyName = `${this.stackName}-${dependency}-${this.environment}`;
      if (
        !ResourceUtil.findResourceOrConfigByName(
          dependencyName,
          registeredResources
        )
      ) {
        pendingRegistrationResources.push(dependencyName);
      }
    }
    // if not, register the necessary dependencies
    if (pendingRegistrationResources.length > 0) {
      const pendingConfigs = [];
      for (const pending of pendingRegistrationResources) {
        const resourceConfig = ResourceUtil.findResourceOrConfigByName(
          pending,
          configs
        );
        if (resourceConfig) {
          pendingConfigs.push(resourceConfig);
        }
      }
      registeredResources.push(
        ...(await this.batchRegister(pendingConfigs, registeredResources, name))
      );
    }
  }
}
