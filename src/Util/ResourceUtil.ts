import VarUtil from "../Util/VarUtil";
import { RegisteredResource, ResourceConfig } from "../Types";
import * as _ from "lodash";
import * as pulumi from "@pulumi/pulumi";
import AzureResourceFactory from "../Azure/AzureResourceFactory";
import AwsResourceFactory from "../Aws/AwsResourceFactory";
import GcpResourceFactory from "../Gcp/GcpResourceFactory";

export default class ResourceUtil {
  constructor(private stackName: string, private environment: string, private platform: string) {
    this.validate();
  }

  validate() {
    if (!this.stackName) throw new Error("stackName must be set");
    if (!this.environment) throw new Error("environment must be set");
    if (!this.platform) throw new Error("platform must be set");
  }

  static findResourceOrConfigByName(name: string, items: any[]) {
    if( items.length > 0 ) {
      return items.find(item => item.name === name);
    }
    return false;
  }

  configure(name: string, type: string, config: any, scope: string, options: any = {}, componentType: string = 'Resource', ): ResourceConfig {
    const propertiesWithVars = VarUtil.process(config, scope);

    return {
      name,
      type,
      scope,
      options,
      componentType,
      propertiesWithVars,
      config
    }
  }

  static flattenResourceArray(resources: RegisteredResource[][]): RegisteredResource[] {
    return [...([] as RegisteredResource[]).concat(...resources)];
  }

  register(config: ResourceConfig, registeredResources:RegisteredResource[] = []) {
    try {

      let provider, newConfig;

      // create provider and newConfig based on the platform we are working on
      switch (this.platform) {
        case "aws":
          switch (config.componentType) {
            case "NativeResource":
              [provider, newConfig] = AwsResourceFactory.getNativeResource(config.name, config.type, config.config);
              break;
            default:
              [provider, newConfig] = AwsResourceFactory.getResource(config.name, config.type, config.config);
          }
          break;
  
        case "azure":
          [provider, newConfig] = AzureResourceFactory.getResource(config.name, config.type, config.config);
          if (config.options.resourceGroup) {
            newConfig.resourceGroupName = config.options.resourceGroup.name;
            newConfig.location = config.options.resourceGroup.location;
          }
          break;
  
        case "gcp":
          [provider, newConfig] = GcpResourceFactory.getResource(config.name, config.type, config.config);
          break;
  
        default:
          throw new Error(`unable to get resource factory for '${this.platform}'`)
      }

      const dependencies = [];
      // iterate over properties that are binded to other objects and create the necessary links in pulumi
      if (Array.isArray(config.propertiesWithVars) && config.propertiesWithVars.length > 0) {
        for (const propertyWithVars of config.propertiesWithVars) {
          const toConcat = [];
          let isObjectBind = false;
          for (const fragment of propertyWithVars.varParts) {
            if( VarUtil.isObject(fragment) ) {
              const dependencyName = `${this.stackName}-${fragment.resource}-${this.environment}`;
              const resource = ResourceUtil.findResourceOrConfigByName(dependencyName, registeredResources);
              if(!resource) {
                throw new Error(`Dependency resource: ${fragment.resource} not found`);
              } else {
                // add this resource as a dependency
                dependencies.push(resource.resource);
                if ( fragment.bindTo != '' )
                  toConcat.push(_.get(resource.resource, fragment.bindTo, fragment.default));
                else
                  isObjectBind = true;
              }
            } else {
              toConcat.push(fragment);
            }
          }
          // if we are binding to a whole resource
          if (propertyWithVars.varParts.length > 1 && isObjectBind)
            throw new Error(`Cannot bind to full resource while using constant prefixes or suffixes at: ${config.name}`);
          else if ( isObjectBind ) {
            _.set(newConfig, propertyWithVars.property, dependencies[0]);
          } else {
            _.set(newConfig, propertyWithVars.property, pulumi.concat(...toConcat));
          }
        }
      }

      const instance = new provider(config.name, newConfig, _.merge({dependesOn: dependencies}, (config.options.options ? config.options.options : {}) )) as pulumi.CustomResource;

      return {
        name: config.name,
        type: config.type,
        resource: instance
      }
    } catch(err) {
      throw new Error(`Unable to create resource ${config.name} of type ${config.type}: ${err}`);
    }
  }

  batchRegister(configs: ResourceConfig[], existingResources: RegisteredResource[] = [], callingResource: string = '') {
    let registeredResources:RegisteredResource[] = existingResources;
    for( const config of configs ) {
      // check if we have dependencies fot this item
      if( Array.isArray( config.propertiesWithVars.length ) ) {
        // if we do, create an array with all resources this item depends on
        const dependencies = [];
        for( const propertyWithVars of config.propertiesWithVars ) {
          // check if the dependency is same as the one that called us and if so, throw and error as we
          // have a circular dependency issue
          for( const fragment of propertyWithVars.varParts ) {
            if( VarUtil.isObject(fragment) ) {
              if( callingResource && fragment.resource == callingResource )
                throw new Error(`Circular dependency error: ${callingResource} and ${fragment.resource} depend each on the other`);
              dependencies.push(fragment.resource);
            }
          }
        }
        // check if all those dependencies are already registered
        const pendingRegistrationResources = [];
        for( const dependency of dependencies ) {
          const dependencyName = `${this.stackName}-${dependency}-${this.environment}`;
          if( !ResourceUtil.findResourceOrConfigByName(dependencyName, registeredResources) ) {
            pendingRegistrationResources.push(dependency);
          }
        }
        // if not, register the necessary dependencies
        if( pendingRegistrationResources.length > 0 ) {
          const pendingConfigs = [];
          for( const pending of pendingRegistrationResources ) {
            const resourceConfig = ResourceUtil.findResourceOrConfigByName(pending.name, configs);
            if( resourceConfig ) {
              pendingConfigs.push( resourceConfig );
            }
          }
          registeredResources.push(...this.batchRegister(pendingConfigs, registeredResources, config.name));
        }
      }
      // finally register the pretinent resource
      registeredResources.push(this.register(config, registeredResources));
    }
    return registeredResources;
  }
}