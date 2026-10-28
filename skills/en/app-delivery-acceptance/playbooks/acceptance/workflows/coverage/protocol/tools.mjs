// Tool descriptions are evidence for readers, not executable tool identities.
export function toolIdentities(tools) {
  if (!Array.isArray(tools) || !tools.length) throw Error('Coverage tools must be a nonempty array');
  const identities = tools.map(tool => {
    if (!tool || !['name', 'version'].every(key => typeof tool[key] === 'string' && tool[key].trim()))
      throw Error('Coverage tool needs an actual name and version: ' + JSON.stringify(tool));
    return {name: tool.name, version: tool.version};
  }).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  if (new Set(identities.map(tool => tool.name)).size !== identities.length)
    throw Error('Coverage tool names must be distinct: ' + JSON.stringify(identities));
  return identities;
}

export function assertToolIdentity(actual, expected, context = 'Coverage tool identity') {
  const received = toolIdentities(actual), wanted = toolIdentities(expected);
  if (JSON.stringify(received) !== JSON.stringify(wanted))
    throw Error(context + ' mismatch; expected=' + JSON.stringify(wanted) + '; actual=' + JSON.stringify(received));
}
