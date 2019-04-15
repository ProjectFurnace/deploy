import * as _ from "lodash";

export default class VarUtil {
  //static readonly VAR_MATCH = /\${([\w-]+):([\w-.]+)(?:[\s]*[,][\s]*["']([\w-.:]+)["'])?}/g;

  static findDependencies(config:any, scope:any, path = '') {
    // iterate through the keys and if it's an object call the function again
    // if not, replace vars
    let output: any[] = [];
    for (const key in config) {
      path = ( path != '' ? path + '.' + key : key );
      if (this.isObject(config[key])) {
        output.push( ...this.findDependencies(config[key], scope, path) );
      } else if (typeof config[key] === 'string' || config[key] instanceof String) {
        if (config[key].includes('${') && config[key].includes('}')) {
          const var_parts = this.splitVariableParts(config[key], scope);
          const dependency = {
            ...var_parts,
            property: path
          }
          output.push( dependency );
          console.log('DEPENDENCY', dependency);
        }
      }
    }
    return output;
  }

  static splitVariableParts(variable: string, scope: string) {
    console.log('VARIABLE', variable);
    const start = variable.indexOf('${');
    const end = variable.indexOf('}');
    console.log( 'START, END', start, end, variable.length);
    const prefix = ( start > 0 ? variable.substring(0, start).trim() : '');
    const sufix = ( variable.length > end ? variable.substring(end + 1).trim() : '');
    const var_full = variable.substring( start + 2, end );
    let var_scope = scope;
    let var_remain = var_full;
    if( var_full.includes(':') ) {
      const var_split = var_full.split(':');
      var_scope = var_split[0].trim();
      var_remain = var_split[1].trim();
    }
    const var_path_default = var_remain.split(',');
    const resource = var_path_default[0].substring(0, var_path_default[0].indexOf('.'))
    const value = var_path_default[0].substring(var_path_default[0].indexOf('.')+1)

    return {
      prefix,
      sufix,
      scope: var_scope,
      bindTo: value,
      resource: resource,
      default: (var_path_default.length > 1 ? var_path_default[1].trim() : '')
    }
  }

  static isObject(val: any) {
    if (val === null) {
      return false;
    }
    // in some cases it may be useful to check also for typeof function
    // return ((typeof val === 'function') || (typeof val === 'object'));
    return (typeof val === 'object');
  }
}