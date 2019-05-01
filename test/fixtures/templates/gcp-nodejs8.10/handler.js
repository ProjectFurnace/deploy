// Imports the Google Cloud client library
const {PubSub} = require('@google-cloud/pubsub');

const topicName = process.env.STREAM_NAME;

const pubsub = new PubSub();

module.exports.process = async function (message, context) {
    console.log(`Raw message: ${message}`);

    const event = message.data ? Buffer.from(message.data, 'base64').toString() : '';

    console.log(`Processed message: ${event}`);

    const dataBuffer = Buffer.from(JSON.stringify(event), 'utf-8');

    // Publishes the message and prints the messageID on console
    const messageId = pubsub.topic(topicName).publish(dataBuffer);
    console.log(`Message ${messageId} published.`);
};