// Screenshots of the demo page in system Chrome: node tools/shot.mjs <out dir> (needs `npm run preview` on :4173)
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "shots";
const url = (q = "") => `http://localhost:4173/${q}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function page(opts = {}, init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2, ...opts });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 404, body: "{}" }));
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  return p;
}
const settle = (p, ms = 400) => p.waitForTimeout(ms);

for (const theme of ["light", "dark"]) {
  // nothing connected
  let p = await page();
  await p.goto(url(`?theme=${theme}`));
  await p.evaluate(() => document.fonts.ready);
  await settle(p, 600);
  await p.screenshot({ path: `${out}/${theme}-idle.png`, fullPage: true });

  // try it: the dragon, then the marquee on the matrix
  await p.getByRole("button", { name: "try it here" }).click();
  await settle(p, 500);
  await p.keyboard.type("sudo\r");
  await settle(p, 1300);
  await p.screenshot({ path: `${out}/${theme}-try-dragon.png`, fullPage: true });

  // a program with the card's button held: the whole matrix lit
  await p.keyboard.type("edit\rtop: mov 0 a\req btn 1\rjf draw\rmov 0xffff a\rdraw: mov 0 row\rnext: mov a pix\radd 1 row\rlt row 9\rjt next\rwait 1\rjmp top\r.\rrun\r");
  await settle(p, 300);
  await p.keyboard.down(" ");
  await settle(p, 300);
  await p.locator(".mc1-stage").screenshot({ path: `${out}/${theme}-try-lit.png` });
  await p.keyboard.up(" ");

  // the firmware panel (no release yet: the manifest isn't there and GitHub is stubbed to 404)
  await p.keyboard.press("Control+C");
  await p.getByRole("button", { name: "firmware" }).click();
  await settle(p, 600);
  await p.locator(".mc1-flash").screenshot({ path: `${out}/${theme}-firmware.png` });
  await p.context().close();

  // a browser without Web Serial: the terminal steps for the visitor's OS
  p = await page({}, () => { delete Object.getPrototypeOf(navigator).serial; });
  await p.goto(url(`?theme=${theme}`));
  await p.getByRole("button", { name: "connect the card" }).click();
  await settle(p, 400);
  await p.locator(".mc1-help").screenshot({ path: `${out}/${theme}-help.png` });
  await p.context().close();
}

// a phone
const phone = await page({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await phone.goto(url("?theme=light"));
await settle(phone, 600);
await phone.screenshot({ path: `${out}/phone.png`, fullPage: true });

await browser.close();
console.log("shots in", out);
