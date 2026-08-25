// Step 2 — build the SHA-256 merkle tree over the dictionary and emit the root
// that gets stored on-chain in GameConfig.merkle_root.
//
// Uses the exact same algorithm as program/src/instructions/submit_word.rs.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { buildTree, rootHex } from '../shared/merkle';

async function main() {
  const dictPath = process.env.DICTIONARY ?? path.resolve(import.meta.dirname!, '../data/dictionary.txt');
  const words = fs
    .readFileSync(dictPath, 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 2 && /^[a-z]+$/.test(w));

  console.log(`dictionary: ${words.length} words (2+ letters, a-z only)`);
  const t0 = Date.now();
  const tree = buildTree(words);
  console.log(`tree built in ${Date.now() - t0}ms, depth ${tree.levels.length - 1}`);
  const root = rootHex(tree.root);
  console.log('merkle root:', root);

  fs.writeFileSync(path.resolve(import.meta.dirname!, '../data/merkle_root.txt'), root + '\n');
  fs.writeFileSync(
    path.resolve(import.meta.dirname!, '../data/merkle_meta.json'),
    JSON.stringify({ words: words.length, depth: tree.levels.length - 1, root }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
