const AWS = require('aws-sdk');
const ks = require('./kinesis');
const logic = require('.');

const client = new AWS.Kinesis({ region: process.env.REGION });

if (logic.unpackAndProcess) ks.unpackAndProcess = logic.unpackAndProcess;

exports.handler = async function handler(ksEvents, context, callback) {
  try {
    if (ksEvents && ksEvents.Records) {
      const outputEvents = await ks.unpackAndProcess(ksEvents.Records);

      if (process.env.STREAM_NAME && outputEvents.length > 0) {
        const out = await ks.send(client, outputEvents);
        callback(null, out);
      } else if (process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.log('No output stream defined or no events to output');
      }
    } else if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.log('No property "Records" in Kinesis received data');
    }
  } catch (e) {
    callback(e);
  }
};
