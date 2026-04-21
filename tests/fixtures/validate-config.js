const fs = require('fs');
const path = require('path');

const [, , configPath] = process.argv;

if (!configPath) {
  console.error('Usage: node validate-config.js <path-to-config.json>');
  process.exit(1);
}

const absolutePath = path.resolve(configPath);

if (!fs.existsSync(absolutePath)) {
  console.error(`Config file not found at ${absolutePath}`);
  process.exit(1);
}

const raw = fs.readFileSync(absolutePath, 'utf-8');
let entries;

try {
  entries = JSON.parse(raw);
} catch (error) {
  console.error('Failed to parse JSON:', error.message);
  process.exit(1);
}

if (!Array.isArray(entries)) {
  console.error('Configuration JSON must be an array.');
  process.exit(1);
}

let isCityConfig = path.basename(absolutePath).toLowerCase().includes('city');
let isSoundConfig = path.basename(absolutePath).toLowerCase().includes('sound');

if (!isCityConfig && !isSoundConfig) {
  const first = entries[0] || {};
  if ('cityKey' in first) {
    isCityConfig = true;
  } else if ('soundProfileId' in first || 'id' in first || 'filePath' in first) {
    isSoundConfig = true;
  }
}

const assertKeys = (obj, keys) => {
  keys.forEach((key) => {
    if (!(key in obj)) {
      throw new Error(`Missing key ${key} in ${JSON.stringify(obj)}`);
    }
  });
};

const validateCity = (city) => {
  assertKeys(city, [
    'cityKey',
    'displayName',
    'seriesSlug',
    'airportCode',
    'timezone',
    'enabled',
  ]);

  if (typeof city.enabled !== 'boolean') {
    throw new Error(`${city.cityKey}: enabled must be boolean`);
  }
};

const validateSound = (profile) => {
  assertKeys(profile, ['id', 'name', 'filePath', 'volume', 'loop']);

  if (typeof profile.volume !== 'number' || profile.volume < 0 || profile.volume > 1) {
    throw new Error(`${profile.id}: volume must be a number between 0 and 1`);
  }
  if (typeof profile.loop !== 'boolean') {
    throw new Error(`${profile.id}: loop must be boolean`);
  }
};

entries.forEach((entry, index) => {
  if (isCityConfig) {
    validateCity(entry);
  } else if (isSoundConfig) {
    validateSound(entry);
  } else {
    console.warn('Unknown config type; skipping validation for entry', index);
  }
});

console.log(`Validated ${entries.length} entries in ${configPath}`);
