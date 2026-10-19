// The key pair behind 🏮 Patron of the Deep's proofs (src/main/patron.js).
//
//   node scripts/patron-keygen.js <private-key-file>
//
// Writes the private key (PKCS#8 PEM) to the file you name, which must not be
// in the repo and must not exist yet, and prints the public key. The private
// key goes to getshellby.com's signer as the PATRON_SIGNING_KEY environment
// variable (x-salmon/shellby-site, api/patron.js); the public key goes in
// PUBLIC_KEYS in src/main/patron.js under the next key id. Proofs carry the id
// of the key that signed them, so an old key can stay trusted while it's phased out.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/patron-keygen.js <private-key-file>');
  process.exit(2);
}
const file = path.resolve(out);
const repo = path.resolve(__dirname, '..');
if (file.toLowerCase().startsWith(repo.toLowerCase() + path.sep)) {
  console.error('The private key must live outside the repo.');
  process.exit(2);
}
if (fs.existsSync(file)) {
  console.error(`${file} exists already: not overwriting a key.`);
  process.exit(2);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
console.log(`Private key written to ${file}`);
console.log('Public key, for src/main/patron.js PUBLIC_KEYS:');
console.log(publicKey.export({ type: 'spki', format: 'pem' }).trim());
