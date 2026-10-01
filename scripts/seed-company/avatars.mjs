// 시연 직원 37명의 프로필 사진 (2026-10-01). 실존하지 않는 사람의 사진을 OpenAI 이미지 생성으로 한 번 만들어
// scripts/seed-company/avatars/<handle>.webp (512×512) 로 저장해 두고, seed-company.mjs 가 avatars 버킷에 올려 프로필 사진으로 정한다.
// 만들기(비용이 든다 — 한 장에 몇 센트): node --env-file=.env.local scripts/seed-company/avatars.mjs [--only dhjung,sylee] [--force]
//   이미 있는 파일은 건너뛴다 (--force 면 다시 만든다). 외부로 나가는 것은 아래 사진 설명 문장뿐이다 (이름·회사 정보는 보내지 않는다).
// 성별·나이대·옷차림은 이름과 직급·부서에 맞춰 시드에서 정한 설정이다 — 바꾸려면 LOOKS 를 고치고 그 사람만 --only --force 로 다시 만든다.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AVATAR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "avatars");
const MODEL = "gpt-image-1.5";

/** handle → [성별, 나이대, 생김새·옷차림] */
export const LOOKS = {
  dhjung: ["man", "late 50s", "short neatly combed gray hair, rimless glasses, charcoal suit, white shirt and a navy tie"],
  swhan: ["man", "mid 50s", "short black hair graying at the temples, navy suit, light blue shirt, no tie"],
  sjoh: ["man", "late 40s", "short side-parted hair, black-rimmed glasses, gray blazer over a white shirt, no tie"],
  jhyoon: ["man", "mid 40s", "short cropped hair, light stubble, navy knit polo shirt"],
  dhkim: ["man", "mid 30s", "medium-length wavy hair, round glasses, gray hoodie over a white t-shirt"],
  dyim: ["man", "early 30s", "short two-block haircut, black t-shirt under an open flannel shirt"],
  sylee: ["woman", "mid 20s", "long straight black hair, light beige cardigan over a white blouse"],
  mhseo: ["man", "around 40", "short hair, thin metal-framed glasses, olive overshirt"],
  hekang: ["woman", "late 20s", "chin-length bob haircut, navy and white striped long-sleeve shirt"],
  ysjo: ["woman", "mid 20s", "hair in a low ponytail, oversized beige sweatshirt, small stud earrings"],
  jybae: ["man", "mid 20s", "short black hair with bangs, white oxford shirt"],
  yjshin: ["woman", "late 40s", "chin-length bob, pearl earrings, cream-colored blazer"],
  thkwon: ["man", "around 40", "short hair, navy cardigan over a checked shirt"],
  jamoon: ["woman", "mid 30s", "wavy shoulder-length dark brown hair, black-framed glasses, navy blouse"],
  sjhong: ["man", "late 20s", "short curly hair, gray crew-neck sweater"],
  jmryu: ["woman", "mid 30s", "short pixie cut, black turtleneck, thin silver necklace"],
  syahn: ["woman", "around 30", "long hair with soft waves, pastel green knit sweater"],
  cwyang: ["woman", "mid 20s", "straight hair with blunt bangs, light denim shirt"],
  tskim: ["man", "mid 50s", "short slicked-back hair, dark navy suit, burgundy tie"],
  jmpark: ["man", "early 50s", "short hair, square glasses, gray suit, white shirt, no tie"],
  sclee: ["man", "late 40s", "short hair, warm smile, navy suit, light blue tie"],
  ynchoi: ["woman", "around 30", "long straight hair tucked behind the ears, black blazer over a white top"],
  hnjung: ["woman", "mid 20s", "shoulder-length hair, bright smile, light gray blazer"],
  msjang: ["man", "around 40", "short hair, short neat beard, navy blazer over a white shirt"],
  desong: ["woman", "mid 30s", "hair tied in a neat low bun, beige blazer"],
  wjjeon: ["man", "late 20s", "short neat hair, eager smile, charcoal suit, no tie"],
  sbhwang: ["woman", "late 40s", "short layered hair, bold earrings, black blazer"],
  ebko: ["woman", "mid 40s", "shoulder-length layered hair, red-rimmed glasses, navy shirt"],
  shbaek: ["man", "early 30s", "medium-length hair styled up, light denim jacket over a white t-shirt"],
  gyyu: ["woman", "mid 20s", "long hair in a half-up style, mustard yellow knit sweater"],
  yhno: ["man", "mid 50s", "short gray hair, half-rim glasses, dark gray suit, blue tie"],
  jhpark: ["man", "mid 40s", "short hair, navy V-neck sweater over a collared shirt"],
  jwha: ["woman", "around 30", "shoulder-length straight hair, soft pink blouse"],
  mjgu: ["man", "late 20s", "short hair, round glasses, light blue shirt"],
  hwcha: ["man", "around 40", "short side-parted hair, gray vest over a white shirt"],
  yrjoo: ["woman", "mid 30s", "long hair in a low ponytail, white blouse, thin gold necklace"],
  jysim: ["man", "mid 20s", "short hair, navy cardigan over a white shirt"],
};

export const avatarFile = (handle) => path.join(AVATAR_DIR, `${handle}.webp`);

function prompt([gender, age, look]) {
  return (
    `Photorealistic corporate headshot for an internal company directory. ` +
    `A fictional Korean ${gender} in their ${age}: ${look}. ` +
    `Head and shoulders, facing the camera, natural friendly expression, soft even studio lighting, plain light gray background, ` +
    `85mm portrait lens look, sharp focus on the eyes. No text, no logo, no watermark. ` +
    `This is an invented person, not a real or famous individual.`
  );
}

async function generate(handle) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: prompt(LOOKS[handle]), size: "1024x1024", quality: "medium", n: 1 }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${handle}: ${res.status} ${body.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
  const sharp = (await import("sharp")).default;
  const webp = await sharp(Buffer.from(body.data[0].b64_json, "base64")).resize(512, 512).webp({ quality: 82 }).toBuffer();
  writeFileSync(avatarFile(handle), webp);
  return { handle, kb: Math.round(webp.length / 1024), usage: body.usage };
}

// 바로 실행하면 없는 사진을 만든다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.OPENAI_API_KEY) {
    console.error(".env.local 에 OPENAI_API_KEY 가 없습니다");
    process.exit(1);
  }
  mkdirSync(AVATAR_DIR, { recursive: true });
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ??
    (process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null);
  const force = process.argv.includes("--force");
  const todo = Object.keys(LOOKS).filter((h) => (!only || only.includes(h)) && (force || !existsSync(avatarFile(h))));
  console.log(`만들 사진 ${todo.length}장 (${MODEL}, 1024 → 512 webp)`);
  let failed = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const done = await Promise.allSettled(todo.slice(i, i + 4).map(generate));
    for (const d of done) {
      if (d.status === "fulfilled") console.log(`  ${d.value.handle} ${d.value.kb}KB ${d.value.usage ? JSON.stringify(d.value.usage) : ""}`);
      else (failed++, console.error(`  실패 ${d.reason.message}`));
    }
  }
  process.exit(failed ? 1 : 0);
}
