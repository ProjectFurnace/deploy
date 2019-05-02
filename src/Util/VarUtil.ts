import * as _ from "lodash";

export default class VarUtil {
  static readonly VAR_MATCH = /\${(?:([\w-]+):)?([\w-]+).([\w-.]+)(?:[\s]*[,][\s]*["']([\w-.:]+)["'])?}/;

  static process(config:any, scope:any, path = '') {
    // iterate through the keys and if it's an object call the function again
    // if not, replace vars
    let output: any[] = [];
    for (const key in config) {
      path = ( path != '' ? path + '.' + key : key );
      if (this.isObject(config[key])) {
        output.push( ...this.process(config[key], scope, path) );
      } else if (typeof config[key] === 'string' || config[key] instanceof String) {
        if (config[key].includes('${') && config[key].includes('}')) {
          const varParts = this.split(config[key], scope);
          const dependency = {
            varParts,
            property: path
          }
          output.push( dependency );
        }
      }
    }
    return output;
  }

  static split(variable: string, scope: string) {
    const bits = [];
    let pos = -1;

    while (pos < variable.length) {
      const varStart = variable.indexOf('${', pos);
      if (varStart !== -1) {
        const varEnd = variable.indexOf('}', varStart);
        if (varEnd === -1) {
          throw Error('Variable close not found');
        }
        if (varStart > pos + 1) {
          bits.push(variable.substring(pos + 1, varStart));
        }
        const varParts = VarUtil.VAR_MATCH.exec(variable.substr(varStart, varEnd));
        if (!varParts) {
          throw Error(`Cannot decode variable format: ${variable}`);
        }
        bits.push({
          scope: (varParts[1] !== undefined ? varParts[1] : scope),
          resource: varParts[2],
          bindTo: varParts[3],
          default: (varParts[4] !== undefined ? varParts[4] : ''),
        });
        pos = varEnd;
      } else if (pos < variable.length) {
        bits.push(variable.substring(pos + 1));
        pos = variable.length;
      }
    }

    return bits;
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