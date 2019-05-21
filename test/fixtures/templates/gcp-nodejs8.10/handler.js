// Imports the Google Cloud client library
const {PubSub} = require('@google-cloud/pubsub');
const index = require('./index');

const pubsub = new PubSub();

module.exports.process = async function (message, context) {
    
    const event = message.data ? JSON.parse( Buffer.from(message.data, 'base64').toString() ): {};

    if (process.env.DEBUG) {
        console.log(`Raw message: ${JSON.stringify(message.data)}`);
        console.log(`Processed message: ${event}`);
    }

    const out = await index.handler(event);

    // Publishes the message and prints the messageID on console
    if (process.env.STREAM_NAME) { 
        //const dataBuffer = Buffer.from(JSON.stringify(out), 'utf-8');
        const messageId = await pubsub.topic(process.env.STREAM_NAME).publishJSON(out);
        console.log(`Message ${messageId} published.`);
    };
};