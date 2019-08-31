const kinesisReceiver = require('./processors/kinesis/receive');
const kinesisSender = require('./processors/kinesis/send');
const sqsReceiver = require('./processors/sqs/receive');
const sqsSender = require('./processors/sqs/send');

module.exports.createInstance = (payload, output) => {
  if (!payload.Records || !payload.Records.length > 0) throw new Error('unable to detect payload type');

  const firstRecord = payload.Records[0];

  let outputType;
  if (output) {
    outputType = output.toLowerCase();
  }

  if (firstRecord.eventSource) {
    switch (firstRecord.eventSource) {
      case 'aws:kinesis':
        return [kinesisReceiver, (outputType === 'sqs' ? sqsSender : kinesisSender)];
      case 'aws:sqs':
        return [sqsReceiver, (outputType === 'kinesis' ? kinesisSender : sqsSender)];
      default:
        throw new Error(`unable to get processor for eventSource ${firstRecord.eventName}`);
    }
  } else {
    throw new Error('eventSource field not available in payload');
  }
};
