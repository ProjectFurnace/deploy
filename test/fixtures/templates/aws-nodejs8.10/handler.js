const furnaceSDK = require('@project-furnace/sdk');
const handlerUtils = require('./handlerUtils');

let logic;

// if this is not a combined function, require the index of the function
// and check if there is a setup method
if (!process.env.COMBINE) {
  // eslint-disable-next-line global-require
  logic = require('./index');

  if (logic.setup) logic.setup();
}

const processorFactory = require('./processorFactory');

let receiver = null;
let sender = null;

exports.handler = async (payload, context, callback) => {
  if (!receiver) {
    [receiver, sender] = processorFactory.createInstance(payload, process.env.OUTPUT_TYPE);
    if (!process.env.COMBINE && logic.receive) {
      receiver = logic.receive;
    }
  }
  try {
    const out = furnaceSDK.fp.pipe(
      handlerUtils.validatePayload,
      receiver,
      handlerUtils.validateEvents,
      sender,
    )(payload);
    callback(null, out);
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.log('An exception ocurred', e);
    }
    callback(e);
  }
};
