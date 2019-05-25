const logic = require('./index');

module.exports.processEvent = async function processEvent(context, eventInput) {
  if (process.env.DEBUG) {
    context.log('EventHub trigger processed an event', eventInput);
  }

  const output = await logic.handler(eventInput, context);

  context.done(null, output);
};
