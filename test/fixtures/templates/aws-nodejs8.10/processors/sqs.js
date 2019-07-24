const AWS = require('aws-sdk');
const uuidv4 = require('uuid/v4');
const path = require('path');
const furnaceSDK = require('@project-furnace/sdk');

const funcArray = [];
let logic;

if (process.env.COMBINE) {
  // eslint-disable-next-line global-require
  const funcs = require('require-all')({
    dirname: path.join(__dirname, '..', 'combined'),
    filter: /(index)\.js$/,
  });

  const funcOrder = process.env.COMBINE.split(',');

  // eslint-disable-next-line no-restricted-syntax
  for (const func of funcOrder) {
    funcArray.push(funcs[func].index.handler);
  }
} else {
  // eslint-disable-next-line global-require
  logic = require('../index');
}

const client = new AWS.SQS({ region: process.env.REGION });

function putRecords(records) {
  return new Promise((resolve, reject) => {
    // parameters for our Kinesis stream
    const params = {
      QueueUrl: process.env.STREAM_NAME,
      Entries: records.map(event => ({
        Id: uuidv4(),
        MessageBody: Buffer.from(JSON.stringify(event)).toString('base64'),
      })),
    };

    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.log(`Sending following data to ${process.env.STREAM_NAME}`, params.Entries);
    }

    client.sendMessageBatch(params, (err) => {
      if (err) {
        // error
        if (process.env.DEBUG) {
          // eslint-disable-next-line no-console
          console.log('An error ocurred when doing sendMessageBatch', err);
        }
        reject(new Error(err));
      } else {
        if (process.env.DEBUG) {
          // eslint-disable-next-line no-console
          console.log(`Pushed ${records.length} events to SQS`);
        }
        resolve(`Pushed ${records.length} events to SQS`);
      }
    });
  });
}

function send(events) {
  if (events.length > 100) {
    const promises = [];
    const slices = Math.ceil(events.length / 100);

    for (let ii = 0; ii < slices; ii += 1) {
      const chunk = events.slice(ii * 100, (ii + 1) * 100);

      promises.push(putRecords(chunk));
    }
    return Promise.all(promises);
  }
  return putRecords(events);
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

module.exports.send = send;
module.exports.receive = receive;
