#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XMLParser } from 'fast-xml-parser';

const inputPath = process.argv[2] || path.join(os.homedir(), 'Documents', 'Zotero', 'Zotero.rdf');
const outputDir = process.argv[3] || path.join(os.homedir(), 'Documents', 'Zotero', 'derived');

const xml = fs.readFileSync(inputPath, 'utf8');
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});
const rdf = parser.parse(xml)['rdf:RDF'];

const asArray = (value) => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

const firstString = (...values) => {
  for (const value of values.flat()) {
    const text = flattenText(value);
    if (text) return text;
  }
  return '';
};

function flattenText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map((entry) => flattenText(entry)).find(Boolean) || '';
  }
  if (typeof value === 'object') {
    if (typeof value['rdf:value'] === 'string') return value['rdf:value'].trim();
    if (typeof value['#text'] === 'string') return value['#text'].trim();
    for (const key of Object.keys(value)) {
      if (key.startsWith('@_')) continue;
      const nested = flattenText(value[key]);
      if (nested) return nested;
    }
  }
  return '';
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugTitle(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function parseYear(dateValue) {
  const match = String(dateValue || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
}

function parseCreators(item) {
  const blocks = [];
  if (item['bib:authors']) blocks.push(item['bib:authors']);
  if (item['z:directors']) blocks.push(item['z:directors']);
  const creators = [];
  for (const block of blocks) {
    const seq = block?.['rdf:Seq']?.['rdf:li'] ?? block?.['rdf:Bag']?.['rdf:li'] ?? [];
    for (const li of asArray(seq)) {
      const person = li?.['foaf:Person'] || li;
      const given = firstString(person?.['foaf:givenName']);
      const surname = firstString(person?.['foaf:surname']);
      const name = normalizeWhitespace([given, surname].filter(Boolean).join(' ')) || firstString(person?.['foaf:name']);
      if (name) creators.push(name);
    }
  }
  return [...new Set(creators)];
}

function parseSubjects(item) {
  const values = [];
  for (const subject of asArray(item['dc:subject'])) {
    const tag = firstString(subject?.['z:AutomaticTag'], subject?.['rdf:value'], subject);
    if (tag) values.push(tag);
  }
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))].sort();
}

function parseLinks(node) {
  return asArray(node).map((entry) => entry?.['@_rdf:resource']).filter(Boolean);
}

function parseIdentifiers(item, about) {
  const texts = [];
  for (const entry of asArray(item['dc:identifier'])) {
    const flattened = flattenText(entry);
    if (flattened) texts.push(flattened);
    const resource = entry?.['dcterms:URI']?.['rdf:value'];
    if (resource) texts.push(resource);
  }
  const prism = firstString(item['prism:number']);
  if (prism) texts.push(prism);
  if (about && /^https?:\/\//.test(about)) texts.push(about);

  const joined = texts.join(' | ');
  const doiMatch = joined.match(/10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+/i);
  const arxivMatch = joined.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arXiv:)(\d{4}\.\d{4,5})(?:v\d+)?/i);
  const url = texts.find((value) => /^https?:\/\//.test(value)) || (about && /^https?:\/\//.test(about) ? about : '');
  const arxiv = arxivMatch ? arxivMatch[1] : '';
  return {
    doi: doiMatch ? doiMatch[0] : '',
    arxiv,
    url,
    identifiers: [...new Set(texts.map((value) => normalizeWhitespace(value)).filter(Boolean))],
  };
}

const attachmentByRef = new Map();
for (const attachment of asArray(rdf['z:Attachment'])) {
  const ref = attachment?.['@_rdf:about'];
  if (!ref) continue;
  attachmentByRef.set(ref, {
    ref,
    title: firstString(attachment['dc:title']),
    path: attachment?.['z:path']?.['@_rdf:resource'] || '',
    url: firstString(attachment?.['dc:identifier']),
    mimeType: firstString(attachment['link:type']),
    linkMode: firstString(attachment['z:linkMode']),
  });
}

const collectionsByResource = new Map();
for (const collection of asArray(rdf['z:Collection'])) {
  const title = firstString(collection['dc:title']);
  if (!title) continue;
  const refs = parseLinks(collection['dcterms:hasPart']);
  for (const ref of refs) {
    const bucket = collectionsByResource.get(ref) || [];
    bucket.push(title);
    collectionsByResource.set(ref, bucket);
  }
}

const itemRecords = [];
for (const [key, rawValue] of Object.entries(rdf)) {
  if (key === 'z:Attachment' || key === 'z:Collection' || key.startsWith('@_') || key === '#text') continue;
  for (const item of asArray(rawValue)) {
    if (!item || typeof item !== 'object') continue;
    const itemType = firstString(item['z:itemType']);
    if (!itemType || itemType === 'attachment') continue;

    const about = item['@_rdf:about'] || '';
    const title = normalizeWhitespace(firstString(item['dc:title'], item['z:shortTitle']));
    const abstract = normalizeWhitespace(firstString(item['dcterms:abstract']));
    const date = normalizeWhitespace(firstString(item['dc:date']));
    const year = parseYear(date);
    const creators = parseCreators(item);
    const tags = parseSubjects(item);
    const identifiers = parseIdentifiers(item, about);
    const attachmentRefs = parseLinks(item['link:link']);
    const attachments = attachmentRefs.map((ref) => attachmentByRef.get(ref)).filter(Boolean);
    const collections = [...new Set(collectionsByResource.get(about) || [])].sort();

    if (!title && !abstract) continue;

    itemRecords.push({
      sourceRef: about,
      itemType,
      title,
      titleSlug: slugTitle(title || about),
      creators,
      date,
      year,
      abstract,
      tags,
      collections,
      doi: identifiers.doi,
      arxiv: identifiers.arxiv,
      url: identifiers.url,
      identifiers: identifiers.identifiers,
      attachments,
    });
  }
}

function dedupeKey(record) {
  if (record.doi) return `doi:${record.doi.toLowerCase()}`;
  if (record.arxiv) return `arxiv:${record.arxiv.toLowerCase()}`;
  return `title:${slugTitle(record.title)}:${record.year || 'na'}`;
}

function mergeRecords(a, b) {
  const pickLonger = (left, right) => (String(right || '').length > String(left || '').length ? right : left);
  return {
    ...a,
    sourceRef: a.sourceRef || b.sourceRef,
    itemType: a.itemType || b.itemType,
    title: pickLonger(a.title, b.title),
    titleSlug: a.titleSlug || b.titleSlug,
    creators: [...new Set([...(a.creators || []), ...(b.creators || [])])],
    date: a.date || b.date,
    year: a.year || b.year,
    abstract: pickLonger(a.abstract, b.abstract),
    tags: [...new Set([...(a.tags || []), ...(b.tags || [])])].sort(),
    collections: [...new Set([...(a.collections || []), ...(b.collections || [])])].sort(),
    doi: a.doi || b.doi,
    arxiv: a.arxiv || b.arxiv,
    url: a.url || b.url,
    identifiers: [...new Set([...(a.identifiers || []), ...(b.identifiers || [])])],
    attachments: [...new Map([...(a.attachments || []), ...(b.attachments || [])].map((entry) => [entry.ref, entry])).values()],
  };
}

const dedupedMap = new Map();
for (const record of itemRecords) {
  const key = dedupeKey(record);
  const existing = dedupedMap.get(key);
  dedupedMap.set(key, existing ? mergeRecords(existing, record) : record);
}

const dedupedItems = [...dedupedMap.values()].sort((a, b) => a.title.localeCompare(b.title));
const abstractItems = dedupedItems.filter((item) => item.abstract);
const uniqueCollections = [...new Set(dedupedItems.flatMap((item) => item.collections))].sort();
const uniqueTags = [...new Set(dedupedItems.flatMap((item) => item.tags))].sort();

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'all-items.json'), JSON.stringify(dedupedItems, null, 2));
fs.writeFileSync(path.join(outputDir, 'abstract-corpus.jsonl'), abstractItems.map((item) => JSON.stringify(item)).join('\n') + '\n');
fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({
  inputPath,
  totalParsedItems: itemRecords.length,
  dedupedItems: dedupedItems.length,
  itemsWithAbstracts: abstractItems.length,
  uniqueCollections: uniqueCollections.length,
  uniqueTags: uniqueTags.length,
  generatedAt: new Date().toISOString(),
}, null, 2));
fs.writeFileSync(path.join(outputDir, 'summary.md'), `# Zotero export summary\n\n- Source: ${inputPath}\n- Parsed items: ${itemRecords.length}\n- Deduped items: ${dedupedItems.length}\n- Items with abstracts: ${abstractItems.length}\n- Unique collections: ${uniqueCollections.length}\n- Unique tags: ${uniqueTags.length}\n\n## Collections\n\n${uniqueCollections.map((value) => `- ${value}`).join('\n')}\n\n## Sample abstract-backed items\n\n${abstractItems.slice(0, 20).map((item) => `- ${item.title} (${item.year || 'n.d.'})`).join('\n')}\n`);

console.log(JSON.stringify({
  outputDir,
  totalParsedItems: itemRecords.length,
  dedupedItems: dedupedItems.length,
  itemsWithAbstracts: abstractItems.length,
  uniqueCollections: uniqueCollections.length,
  uniqueTags: uniqueTags.length,
}, null, 2));
