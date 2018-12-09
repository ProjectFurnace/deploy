const elasticsearch = require('elasticsearch');

const connParams = {
  host: process.env.SERVER,
  requestTimeout: process.env.TIMEOUT || 3000,
};

if (process.env.IS_AWS) {
  // eslint-disable-next-line global-require
  const httpaws = require('http-aws-es');
  connParams.connectionClass = httpaws;
}

if (process.env.DEBUG) {
  connParams.log = 'trace';
}

const client = new elasticsearch.Client(connParams);

// we want to overwrite this to be able to do batch processing
async function unpackAndProcess(events) {
  const outputEvents = [];
  outputEvents[0] = [];

  let currentBatchSize = 0;
  let batchNum = 0;

  // create array with the events we want to send in the format expected by ES bulk request
  events.forEach((elem) => {
    if (elem.kinesis && elem.kinesis.data) {
      const action = { index: { _index: process.env.INDEX, _type: process.env.TYPE } };
      const event = JSON.parse(Buffer.from(elem.kinesis.data, 'base64'));
      outputEvents[batchNum].push(action, event);
      // keep track of the batch size and increment the batch num if we have already enough
      // events in that batch
      currentBatchSize += 1;
      if (currentBatchSize >= process.env.BATCH) {
        batchNum += 1;
        currentBatchSize = 0;
        outputEvents[batchNum] = [];
      }
    }
  });
  // if we have events on our array, send them to elastic
  if (outputEvents.length > 0) {
    const promises = [];
    for (let ii = 0; ii < outputEvents.length; ii += 1) {
      promises.push(client.bulk({ body: outputEvents[ii] }));
    }
    const results = await Promise.all(promises);
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.log(results);
    }
  }
  // return empty so we send nothing to an output queue - this is just a sink
  return [];
}

module.exports.unpackAndProcess = unpackAndProcess;
