#!/usr/bin/env node
// Build the SpaceTraders External Service registrations from the official
// OpenAPI spec: one registration per Named Credential (Public, Account, Agent).
// External Services ignores the spec's security and authenticates with the
// registration's Named Credential, so each token type needs its own registration.
//
// Usage: node scripts/split-spec.mjs [specUrlOrPath] [outDir]
//   specUrlOrPath  default: the SpaceTraders spec on GitHub (main branch)
//   outDir         default: force-app/main/default/externalServiceRegistrations
//
// Writes SpaceTraders<Group>.externalServiceRegistration-meta.xml with every
// operation active. Deploy with:
//   sf project deploy start -m ExternalServiceRegistration
//
// The upstream spec references ../models/*.json files. External Services needs
// a single document, so every referenced file is hoisted into
// components/schemas/<FileName> and its $ref rewritten. Each registration keeps
// only the schemas its own operations reach, since inactive objects still count
// against org limits. Operation ids are camelCased (get-my-agent -> getMyAgent)
// so the generated Apex methods read as svc.getMyAgent().

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SPEC =
  'https://raw.githubusercontent.com/SpaceTradersAPI/api-docs/main/reference/SpaceTraders.json';
const DEFAULT_OUT = 'force-app/main/default/externalServiceRegistrations';
const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const CREDENTIALS = { Public: 'SpaceTraders_Public', Account: 'SpaceTraders_Account', Agent: 'SpaceTraders_Agent' };

// operationId -> group, for operations the security-based rule gets wrong.
const OVERRIDES = {
  'get-faction': 'Public', // spec omits security; endpoint answers without a token
};

const input = process.argv[2] || DEFAULT_SPEC;
const outDir = process.argv[3] || DEFAULT_OUT;
const rootUrl = /^https?:/.test(input) ? new URL(input) : pathToFileURL(resolve(input));

async function load(url) {
  if (url.protocol === 'file:') return JSON.parse(await readFile(url, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
}

// Hoist external file refs into components/schemas, keyed by file name.
const hoisted = {};
const nameByUrl = new Map();

async function inline(node, baseUrl) {
  if (Array.isArray(node)) return Promise.all(node.map((n) => inline(n, baseUrl)));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
      out.$ref = `#/components/schemas/${await hoist(new URL(value, baseUrl))}`;
    } else {
      out[key] = await inline(value, baseUrl);
    }
  }
  return out;
}

async function hoist(url) {
  if (url.hash) throw new Error(`Refs into a file fragment aren't handled: ${url}`);
  const key = url.href;
  if (nameByUrl.has(key)) return nameByUrl.get(key);
  const name = url.pathname.split('/').pop().replace(/\.json$/, '');
  if ([...nameByUrl.values()].includes(name)) throw new Error(`Schema name collision: ${name}`);
  nameByUrl.set(key, name);
  hoisted[name] = await inline(await load(url), url);
  return name;
}

function groupFor(op, globalSecurity) {
  if (OVERRIDES[op.operationId]) return OVERRIDES[op.operationId];
  const security = op.security ?? globalSecurity ?? [];
  if (security.length === 0 || security.some((req) => Object.keys(req).length === 0)) return 'Public';
  if (security.some((req) => 'AgentToken' in req)) return 'Agent';
  if (security.some((req) => 'AccountToken' in req)) return 'Account';
  throw new Error(`Unknown security on ${op.operationId}: ${JSON.stringify(security)}`);
}

// Collect every #/components/<section>/<name> reachable from node.
function reachable(node, components, seen = new Set()) {
  JSON.stringify(node, (key, value) => {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/')) {
      if (!seen.has(value)) {
        seen.add(value);
        const [, , section, name] = value.split('/');
        reachable(components[section]?.[name], components, seen);
      }
    }
    return value;
  });
  return seen;
}

const camel = (id) => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
// Operation developer name as External Services encodes it: lowercase, other characters as x<hex>.
const operationName = (id) => id.toLowerCase().replace(/[^a-z0-9]/g, (c) => 'x' + c.charCodeAt(0).toString(16));
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function registration(label, credential, spec, operationIds) {
  const binding = JSON.stringify({
    host: '', basePath: '/', allowedSchemes: [], requestMediaTypes: [], responseMediaTypes: [],
    compatibleMediaTypes: {}, integrationFlags: null, extensions: {},
  });
  const operations = operationIds
    .map((id) => `    <operations>\n        <active>true</active>\n        <name>${operationName(id)}</name>\n    </operations>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ExternalServiceRegistration xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>${label}</label>
    <namedCredentialReference>${credential}</namedCredentialReference>
${operations}
    <registrationProviderType>Custom</registrationProviderType>
    <schema>${xml(JSON.stringify(spec))}</schema>
    <schemaType>OpenApi3</schemaType>
    <serviceBinding>${xml(binding)}</serviceBinding>
    <status>Complete</status>
</ExternalServiceRegistration>
`;
}

const spec = await inline(await load(rootUrl), rootUrl);
spec.components ??= {};
spec.components.schemas ??= {};
for (const [name, schema] of Object.entries(hoisted)) {
  if (spec.components.schemas[name]) throw new Error(`Schema name collision: ${name}`);
  spec.components.schemas[name] = schema;
}

const groups = { Public: {}, Account: {}, Agent: {} };
const opIds = { Public: [], Account: [], Agent: [] };
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const group = groupFor(op, spec.security);
    if (!op.security && !OVERRIDES[op.operationId]) {
      console.warn(`warn: ${op.operationId} has no security; inherited global -> ${group}`);
    }
    op.operationId = camel(op.operationId);
    opIds[group].push(op.operationId);
    const target = (groups[group][path] ??= {});
    if (item.parameters) target.parameters = item.parameters;
    target[method] = op;
  }
}

await mkdir(outDir, { recursive: true });
for (const [group, paths] of Object.entries(groups)) {
  const refs = reachable(paths, spec.components);
  const components = {};
  for (const [section, entries] of Object.entries(spec.components)) {
    const kept = Object.entries(entries).filter(
      ([name]) => section === 'securitySchemes' || refs.has(`#/components/${section}/${name}`)
    );
    if (kept.length) components[section] = Object.fromEntries(kept);
  }
  const label = `SpaceTraders${group}`;
  const out = { ...spec, info: { ...spec.info, title: label }, paths, components };
  delete out.tags;
  // The Named Credential URL already ends in /v2; a servers path would be appended to it.
  delete out.servers;
  const file = resolve(outDir, `${label}.externalServiceRegistration-meta.xml`);
  await writeFile(file, registration(label, CREDENTIALS[group], out, opIds[group]));
  const schemas = components.schemas ? Object.keys(components.schemas).length : 0;
  console.log(`${group}: ${opIds[group].length} operations, ${schemas} schemas -> ${file}`);
}
