const logic = require('.');

function send(client, events) {
  return new Promise((resolve, reject) => {
    // parameters for our Kinesis stream
    const params = {
      StreamName: process.env.STREAM_NAME,
      Records: events.map(event => ({
        Data: JSON.stringify(event),
        PartitionKey: process.env.PARTITION_KEY,
      })),
    };

    client.putRecords(params, (err) => {
      if (err) {
        // error
        reject(new Error(err));
      } else {
        resolve(`Pushed ${events.length} events to Kinesis`);
      }
    });
  });
}

function unpackAndProcess(events) {
  const outputEvents = [];
  events.forEach((elem) => {
    if (elem.kinesis && elem.kinesis.data) {
      const event = JSON.parse(Buffer.from(elem.kinesis.data, 'base64'));
      outputEvents.push(logic.handler(event));
    } else if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.log('No "kinesis" or "data" properties in events received');
    }
  });
  return outputEvents;
}

module.exports.send = send;
module.exports.unpackAndProcess = unpackAndProcess;
