// Imports the Google Cloud client library
const { PubSub } = require('@google-cloud/pubsub');
const index = require('./index');

const pubsub = new PubSub();

module.exports.process = async function processEvent(message, context) {
  const event = message.data ? JSON.parse(Buffer.from(message.data, 'base64').toString()) : {};

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`Raw message: ${JSON.stringify(message.data)}`);
    // eslint-disable-next-line no-console
    console.log(`Processed message: ${event}`);
  }

  const out = await index.handler(event);

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
