const path = require('path');
const furnaceSDK = require('@project-furnace/sdk');

const funcArray = [];
let logic;

if (process.env.COMBINE) {
  // eslint-disable-next-line global-require
  const funcs = require('require-all')({
    dirname: path.join(__dirname, '../..', 'combined'),
    filter: /(index)\.js$/,
  });

  const funcOrder = process.env.COMBINE.split(',');

  // eslint-disable-next-line no-restricted-syntax
  for (const func of funcOrder) {
    funcArray.push(funcs[func].index.handler);
  }
} else {
  // eslint-disable-next-line global-require
  logic = require('../../index');
}

async function receive(events) {
  const outputEvents = [];
  for (let ii = 0; ii < events.length; ii += 1) {
    if (events[ii] && events[ii].body) {
      const event = JSON.parse(Buffer.from(events[ii].body, 'base64'));
      // we are using a for loop that allows for async
      // eslint-disable-next-line no-await-in-loop
      if (!process.env.COMBINE) {
        // we are using a for loop that allows for async
        // eslint-disable-next-line no-await-in-loop
        outputEvents.push(await logic.handler(event));
      } else {
        // eslint-disable-next-line no-await-in-loop
        const out = await furnaceSDK.fp.pipe(
          ...funcArray,
        )(event);
        outputEvents.push(out);
      }
    } else if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.log('No "body" property in received events');
    }
  }
  return outputEvents;
}

module.exports.receive = receive;
