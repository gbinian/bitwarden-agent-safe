#!/usr/bin/env node
const secret = process.env.TEST_SECRET ?? '';
process.stdout.write(`exact=${secret}\n`);
process.stdout.write(`url=${encodeURIComponent(secret)}\n`);
process.stdout.write(`base64=${Buffer.from(secret).toString('base64')}\n`);
process.stderr.write(`stderr=${secret}\n`);
process.stdout.write(`unrelated=${process.env.UNRELATED_HOST_SECRET ?? ''}\n`);
