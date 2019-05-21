const logic = require('./index');

module.exports = async function (context, eventInput) {
  if (process.env.DEBUG)
    context.log('node EventHub trigger function processed a request.', eventInput);

  const output = await logic.handler(eventInput, context);

  context.done(null, output);
};
