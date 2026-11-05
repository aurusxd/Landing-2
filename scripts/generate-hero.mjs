#!/usr/bin/env node
// Перегенерирует портрет для первого экрана через Polza AI (Nano Banana 2 Lite, 2,90 ₽ за запрос).
// На вход идёт исходное фото assets/source/me-original.webp, лицо сохраняется.
// Ключ берётся из POLZA_API_KEY или из файла .env в корне проекта.
//
//   node scripts/generate-hero.mjs            один вариант
//   node scripts/generate-hero.mjs --count 3  три варианта
//
// Варианты складываются в assets/source/ (в git и на хостинг не попадают).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://polza.ai/api/v1/media';
const MODEL = 'google/gemini-3.1-flash-lite-image';
const SOURCE = join(root, 'assets', 'source', 'me-original.webp');

const PROMPT = `Use the attached photo as the identity reference. Keep this exact young man recognisable: the same face, the same nose, lips, jaw and eyebrows, the same shoulder-length dark wavy hair.
Create a new black and white fine-art studio portrait of him, medium format, silver gelatin tonality with deep blacks and soft pearly highlights.
Pose: three-quarter view turned toward the right of the frame, head tilted back and chin raised, face lifted toward soft light from above, eyes gently closed, calm and focused expression, as if deep in thought.
Crop: head and neck in the upper and middle part of the frame, the shoulders and a plain black crew-neck t-shirt cut off by the bottom edge of the frame. The head is centred horizontally and takes about 60 percent of the frame height, with empty space above the hair and on both sides.
Background: perfectly flat seamless warm off-white paper, colour #F8F6F1, edge to edge, no gradient, no vignette, no cast shadow.
Fully monochrome, no colour anywhere except the paper tone. Natural skin texture, real photograph, not an illustration.
No text, no letters, no logo, no watermark, no frame, no border, no jewellery, no glasses, no interface.
Premium, calm, award-winning editorial art direction.`;

function apiKey() {
  if (process.env.POLZA_API_KEY) return process.env.POLZA_API_KEY.trim();
  const file = join(root, '.env');
  if (existsSync(file)) {
    const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => /^\s*POLZA_API_KEY\s*=/.test(l));
    if (line) return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  console.error('Нет ключа. Создайте файл .env рядом с index.html со строкой POLZA_API_KEY=ваш_ключ');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Опрос статуса и скачивание безопасно повторять: сеть иногда обрывается на минуту.
async function retry(fn, label) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (error) {
      if (i >= 8) throw error;
      console.error(`${label}: сеть не ответила (${error.cause?.code ?? error.name}), повтор ${i}`);
      await sleep(5000 * i);
    }
  }
}

async function generate(key, attempt, photo) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const res = await fetch(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      input: { prompt: PROMPT, aspect_ratio: '1:1', images: [{ type: 'base64', data: `data:image/webp;base64,${photo}` }] },
    }),
  });
  let job = await res.json();
  console.log(`Задача ${job.id ?? 'без id'}, статус ${job.status}`);
  if (!res.ok) throw new Error(`Polza ответила ${res.status}: ${JSON.stringify(job).slice(0, 300)}`);

  const started = Date.now();
  while (job.status !== 'completed') {
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error(`Генерация не удалась: ${JSON.stringify(job).slice(0, 300)}`);
    if (Date.now() - started > 240_000) throw new Error('Генерация не уложилась в 4 минуты');
    await sleep(4000);
    job = await retry(async () => (await fetch(`${API}/${job.id}`, { headers })).json(), 'Статус');
  }

  const url = job.output?.url ?? job.data?.[0]?.url ?? job.output?.[0]?.url;
  if (!url) throw new Error(`В ответе нет ссылки на картинку: ${JSON.stringify(job).slice(0, 300)}`);
  const image = Buffer.from(await retry(async () => (await fetch(url)).arrayBuffer(), 'Скачивание'));

  const dir = join(root, 'assets', 'source');
  mkdirSync(dir, { recursive: true });
  const name = `portrait-${Date.now().toString(36)}-${attempt}.png`;
  writeFileSync(join(dir, name), image);
  console.log(`assets/source/${name}  ${(image.length / 1024).toFixed(0)} КБ`);
}

const countFlag = process.argv.indexOf('--count');
const count = countFlag > -1 ? Math.min(Number(process.argv[countFlag + 1]) || 1, 6) : 1;
const key = apiKey();
const photo = readFileSync(SOURCE).toString('base64');
const results = await Promise.allSettled(Array.from({ length: count }, (_, i) => generate(key, i + 1, photo)));
for (const r of results) if (r.status === 'rejected') console.error(r.reason.message);
