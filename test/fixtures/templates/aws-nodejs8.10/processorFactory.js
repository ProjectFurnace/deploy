const kinesis = require('./processors/kinesis');
const sqs = require('./processors/sqs');

module.exports.createInstance = (payload) => {
  if (!payload.Records || !payload.Records.length > 0) throw new Error('unable to detect payload type');

  const firstRecord = payload.Records[0];

  if (firstRecord.eventSource) {
    switch (firstRecord.eventSource) {
      case 'aws:kinesis':
        return kinesis;
      case 'aws:sqs':
        return sqs;
      default:
        throw new Error(`unable to get processor for eventSource ${firstRecord.eventName}`);
    }
  } else {
    throw new Error('eventSource field not available in payload');
  }
};
