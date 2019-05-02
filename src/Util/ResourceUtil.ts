import VarUtil from "../Util/VarUtil";
import { RegisteredResource, ResourceConfig } from "../Types";
import * as _ from "lodash";
import * as pulumi from "@pulumi/pulumi";
import AzureResourceFactory from "../Azure/AzureResourceFactory";
import AwsResourceFactory from "../Aws/AwsResourceFactory";
import GcpResourceFactory from "../Gcp/GcpResourceFactory";

export default class ResourceUtil {
  static findResourceOrConfigByName(name: string, items: any[]) {
    if( items.length > 0 ) {
      return items.find(item => item.name === name);
    }
    return false;
  }

  static configure(name: string, type: string, config: any, scope: string): ResourceConfig {
    const propertiesWithVars = VarUtil.process(config, scope);

    return {
      name,
      type,
      scope,
      propertiesWithVars,
      config
    }
  }

  static flattenResourceArray(resources: RegisteredResource[][]): RegisteredResource[] {
    return [...([] as RegisteredResource[]).concat(...resources)];
  }

  static register(config: ResourceConfig, platform: string, platformConfig: any, stackName: string, environment: string, registeredResources:RegisteredResource[] = [], resourceOptions:any = {}) {
    try {

      let provider, newConfig;

      // create provider and newConfig based on the platform we are working on
      switch (platform) {
        case "aws":
          switch (platformConfig.componentType) {
            case "NativeResource":
              [provider, newConfig] = AwsResourceFactory.getNativeResource(config.name, config.type, config.config);
              break;
            default:
              [provider, newConfig] = AwsResourceFactory.getResource(config.name, config.type, config.config);
          }
          break;
  
        case "azure":
          [provider, newConfig] = AzureResourceFactory.getResource(config.name, config.type, config.config);
          if (platformConfig.resourceGroup) {
            newConfig.resourceGroupName = platformConfig.resourceGroup.name;
            newConfig.location = platformConfig.resourceGroup.location;
          }
          break;
  
        case "gcp":
          [provider, newConfig] = GcpResourceFactory.getResource(config.name, config.type, config.config);
          break;
  
        default:
          throw new Error(`unable to get resource factory for '${platform}'`)
      }

      const dependencies = [];
      // iterate over properties that are binded to other objects and create the necessary links in pulumi
      if (Array.isArray(config.propertiesWithVars) && config.propertiesWithVars.length > 0) {
        for (const propertyWithVars of config.propertiesWithVars) {
          const toConcat = [];
          let isObjectBind = false;
          for (const fragment of propertyWithVars.varParts) {
            if( VarUtil.isObject(fragment) ) {
              const dependencyName = `${stackName}-${fragment.resource}-${environment}`;
              const resource = this.findResourceOrConfigByName(dependencyName, registeredResources);
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
      const instance = new provider(config.name, newConfig, _.merge({dependesOn: dependencies}, resourceOptions)) as pulumi.CustomResource;

      return {
        name: config.name,
        type: config.type,
        resource: instance
      }
    } catch(err) {
      throw new Error(`Unable to create resource ${config.name} of type ${config.type}: ${err}`);
    }
  }

  static batchRegister(configs: ResourceConfig[], platform: string, platformConfig: any, stackName: string, environment: string, existingResources: RegisteredResource[] = [], callingResource: string = '') {
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
          const dependencyName = `${stackName}-${dependency}-${environment}`;
          if( !this.findResourceOrConfigByName(dependencyName, registeredResources) ) {
            pendingRegistrationResources.push(dependency);
          }
        }
        // if not, register the necessary dependencies
        if( pendingRegistrationResources.length > 0 ) {
          const pendingConfigs = [];
          for( const pending of pendingRegistrationResources ) {
            const resourceConfig = this.findResourceOrConfigByName(pending.name, configs);
            if( resourceConfig ) {
              pendingConfigs.push( resourceConfig );
            }
          }
          registeredResources.push(...this.batchRegister(pendingConfigs, platform, platformConfig, stackName, environment, registeredResources, config.name));
        }
      }
      // finally register the pretinent resource
      registeredResources.push(this.register(config, platform, platformConfig, stackName, environment, registeredResources));
    }
    return registeredResources;
  }
}