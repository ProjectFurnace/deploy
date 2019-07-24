// Imports the Google Cloud client library
const { PubSub } = require('@google-cloud/pubsub');
const path = require('path');
const furnaceSDK = require('@project-furnace/sdk');

const funcArray = [];
let logic;

if (process.env.COMBINE) {
  // eslint-disable-next-line global-require
  const funcs = require('require-all')({
    dirname: path.join(__dirname, 'combined'),
    filter: /(index)\.js$/,
  });

  const funcOrder = process.env.COMBINE.split(',');

  // eslint-disable-next-line no-restricted-syntax
  for (const func of funcOrder) {
    funcArray.push(funcs[func].index.handler);
  }
} else {
  // eslint-disable-next-line global-require
  logic = require('./index');
}

const pubsub = new PubSub();

module.exports.process = async function processEvent(message, context) {
  const event = message.data ? JSON.parse(Buffer.from(message.data, 'base64').toString()) : {};

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`Raw message: ${JSON.stringify(message.data)}`);
    // eslint-disable-next-line no-console
    console.log(`Processed message: ${event}`);
  }

  let out;

  if (!process.env.COMBINE) {
    // we are using a for loop that allows for async
    // eslint-disable-next-line no-await-in-loop
    out = await logic.handler(event);
  } else {
    // eslint-disable-next-line no-await-in-loop
    out = await furnaceSDK.fp.pipe(
      ...funcArray,
    )(event);
  }

  // Publishes the message and prints the messageID on console
  if (process.env.STREAM_NAME && out != null) {
    try {
      const messageId = await pubsub.topic(process.env.STREAM_NAME).publishJSON(out);
      // eslint-disable-next-line no-console
      console.log(`Message ${messageId} published.`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(new Error(e));
    }
  }
};
