const simplejson = require('@project-furnace/simplejsonutils');

function mapProtocol(event, lookup, protocolField) {
  // get the data from the protocol number specified in protocolField
  try {
    const protocolNum = simplejson.getPath(event, protocolField);
    const protocolData = lookup.get(protocolNum);

    if (protocolData) {
      // eslint-disable-next-line no-param-reassign
      event.network.protocol = protocolData;
    } else {
      simplejson.merge(event, { meta: { lookup: { protocol: { error: 'Undefined protocol data', field: protocolField } } } });
    }
  } catch (e) {
    // do nothing
  }
  return event;
}

module.exports.mapProtocol = mapProtocol;
