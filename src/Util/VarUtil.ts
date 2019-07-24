import * as _ from 'lodash';

export default class VarUtil {
  public static process(config: any, scope: any, path = '') {
    // iterate through the keys and if it's an object call the function again
    // if not, replace vars
    const output: any[] = [];
    let newpath: string = '';
    for (const key in config) {
      if( Array.isArray(config) )
        newpath = ( path != '' ? path + '[' + key + ']' : key );
      else
        newpath = ( path != '' ? path + '.' + key : key );
      if (this.isObject(config[key])) {
        output.push( ...this.process(config[key], scope, newpath) );
      } else if (typeof config[key] === 'string' || config[key] instanceof String) {
        if (config[key].includes('${') && config[key].includes('}')) {
          const varParts = this.split(config[key], scope);
          const dependency = {
            varParts,
            property: newpath
          }
          output.push( dependency );
        }
      }
    }
    return output;
  }

  public static isObject(val: any) {
    if (val === null) {
      return false;
    }
    // in some cases it may be useful to check also for typeof function
    // return ((typeof val === 'function') || (typeof val === 'object'));
    return (typeof val === 'object');
  }

  // vars defined in format: ${type:resource_name.property,'default_val'}
  // if type is ommited, the same type of the linking resource is taken
  // (so we look at resources in the same file essentially)
  // tslint:disable-next-line:max-line-length
  private static readonly VAR_MATCH = /\${(?:([\w-]+):)?([\w-]+)(?:\.([\w-.]+))?(?:[\s]*[,][\s]*["']*([\w-.:]+)["']*)?}/;

  private static split(variable: string, scope: string) {
    const bits = [];
    let pos = 0;

    while (pos < variable.length) {
      const varStart = variable.indexOf('${', pos);
      if (varStart !== -1) {
        const varEnd = variable.indexOf('}', varStart) + 1;
        if (varEnd === -1) {
          throw Error('Variable close not found');
        }
        if (varStart > pos) {
          bits.push(variable.substring(pos, varStart));
        }
        const varParts = VarUtil.VAR_MATCH.exec(variable.substr(varStart, varEnd));
        if (!varParts) {
          throw Error(`Cannot decode variable format: ${variable}`);
        }
        bits.push({
          bindTo: varParts[3],
          default: (varParts[4] !== undefined ? varParts[4] : ''),
          resource: varParts[2],
          scope: (varParts[1] !== undefined ? varParts[1] : scope),
        });
        pos = varEnd;
      } else if (pos < variable.length) {
        bits.push(variable.substring(pos));
        pos = variable.length;
      }
    }

    return bits;
  }
}
