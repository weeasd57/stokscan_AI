// Offline checks must never fall through to a provider or public search API.
// Individual tests can replace these stubs with their own fixture responses.
const blocked = () => { throw new Error('Unmocked network access is disabled in offline Jest tests.'); };
global.fetch = jest.fn(async () => blocked());
for (const transport of ['node:http', 'node:https']) {
    const module = require(transport);
    jest.spyOn(module, 'request').mockImplementation(blocked);
    jest.spyOn(module, 'get').mockImplementation(blocked);
}
jest.spyOn(require('node:net').Socket.prototype, 'connect').mockImplementation(blocked);
