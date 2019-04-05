const logic = require('./index');

module.exports = async function process(context, eventInput) {
  context.log('node EventHub trigger function processed a request.', eventInput);

  const output = await logic.handler(eventInput);

  context.done(null, output);
};
