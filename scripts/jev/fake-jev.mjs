// A fake Jev server on localhost, for tests only. Point a client or a CLI at it with
// TYPESAFE_BASE_URL=<url>; it records every request and answers with whatever `reply` returns.
//
//   const jev = await fakeJev((request) => ({ status: 200, body: { answers } }));
//   ... jev.url, jev.requests ...
//   await jev.close();
//
// `request` is { method, url, headers, body }, with `body` parsed as JSON. `reply` returns
// { status, body } or a promise of one; a string body is sent as is, anything else as JSON. A promise
// that never settles holds the request open, to test a timeout.

import http from 'node:http';

export async function fakeJev(reply) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
    const request = { method: req.method, url: req.url, headers: req.headers, body };
    requests.push(request);
    const { status, body: out = '' } = await reply(request);
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    res.writeHead(status, { 'content-type': typeof out === 'string' ? 'text/plain' : 'application/json' });
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
