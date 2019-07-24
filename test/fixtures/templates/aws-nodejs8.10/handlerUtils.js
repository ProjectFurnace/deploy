const AWS = require('aws-sdk');
const awsParamStore = require('aws-param-store');
const path = require('path');

function validatePayload(payload) {
  if (payload && payload.Records) {
    return payload.Records;
  }
  throw new Error('No property "Records" in received event');
}

function validateEvents(events) {
  if (process.env.STREAM_NAME && events.length > 0) {
    return events;
  }
  throw new Error('No output stream defined or no events to output');
}

// process any input parameters we may have and dump them into ENV vars
const inputParameters = awsParamStore.getParametersByPathSync(`/${process.env.FURNACE_INSTANCE}/${process.env.AWS_LAMBDA_FUNCTION_NAME}/`);
if (inputParameters) {
  inputParameters.forEach((param) => {
    const envVarName = 'INPUT_'.concat(param.Name.substr(param.Name.lastIndexOf('/') + 1).replace(/\./g, '_').toUpperCase());
    process.env[envVarName] = param.Value;
  });
}

if (process.env.COMBINE) {
  // eslint-disable-next-line global-require
  const funcs = require('require-all')({
    dirname: path.join(__dirname, 'combined'),
    filter: /(index)\.js$/,
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const folder of Object.values(funcs)) {
    if (folder.index.setup) {
      folder.index.setup();
    }
  }
}

module.exports.validatePayload = validatePayload;
module.exports.validateEvents = validateEvents;
