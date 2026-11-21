// Screenshots of the demo page in system Chrome: node tools/shot.mjs <out dir> [card|nousb|levels]
// (needs `npm run preview` on :4173, or SHOT_URL=http://localhost:5173/ for the dev server; `card` takes
// only the card, in both themes; `nousb` only the page as a browser without Web Serial and WebUSB sees it;
// `levels` a card on usb showing a frame of its cube)
import { chromium, devices } from "playwright-core";

const out = process.argv[2] ?? "shots";
const only = process.argv[3];
const base = process.env.SHOT_URL ?? "http://localhost:4173/";
const url = (q = "") => `${base}${q}`;
// headless Chrome has no WebGL of its own: SwiftShader draws the 3D card
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});

async function page(opts = {}, init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2, ...opts });
  await ctx.route(/api\.github\.com/, (r) => r.fulfill({ status: 404, body: "{}" }));
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.error("page error:", e.message));
  p.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
  return p;
}
const settle = (p, ms = 400) => p.waitForTimeout(ms);
// the 3D card up and at rest (the drawing stays where there's no WebGL: then don't wait long)
const card = (p) => p.locator(".mk1-cardstage[data-settled]").waitFor({ timeout: 20000 }).catch(() => {});

// Firefox and Safari have neither Web Serial nor WebUSB: the page as it meets them, the terminal steps after
// "connect the card", and the firmware panel's way without WebUSB
async function noUsb(theme) {
  const p = await page({}, () => {
    const nav = Object.getPrototypeOf(navigator);
    delete nav.serial;
    delete nav.usb;
  });
  await p.goto(url(`?theme=${theme}`));
  await p.evaluate(() => document.fonts.ready);
  await card(p);
  await settle(p, 600);
  await p.screenshot({ path: `${out}/${theme}-nousb.png`, fullPage: true });
  await p.getByRole("button", { name: "connect the card" }).click();
  await settle(p, 700);
  await p.locator(".mk1-help").screenshot({ path: `${out}/${theme}-help.png` });
  await p.getByRole("button", { name: "firmware" }).click();
  await settle(p, 700);
  await p.screenshot({ path: `${out}/${theme}-nousb-open.png`, fullPage: true });
  await p.context().close();
}

if (only === "card") {
  for (const theme of ["light", "dark"]) {
    const p = await page();
    await p.goto(url(`?theme=${theme}`));
    await card(p);
    await settle(p, 300);
    // the card with the room its tilt and shadow take round it
    const box = await p.locator(".mk1-cardstage").boundingBox();
    const clip = { x: box.x - box.width * 0.1, y: box.y - box.height * 0.14, width: box.width * 1.2, height: box.height * 1.3 };
    await p.screenshot({ path: `${out}/${theme}-card.png`, clip });
    await p.context().close();
  }
  await browser.close();
  console.log("shots in", out);
  process.exit(0);
}

// a card on usb showing its own screen: a stand-in port answers the page's hello with one frame of the cube,
// the levels in between that the shell never sends
const CUBE = "00000002410000000000003c79000000000005c66a60000000007b6226b4000000009420034a100000003c6136890000000005b55a8000000000007ab60000000000000440000000";
const fakeCard = `{
  const port = {
    getInfo: () => ({ usbVendorId: 0x2e8a }),
    async open() {
      let card;
      this.readable = new ReadableStream({ start: (c) => { card = c; } });
      this.writable = new WritableStream({
        write: (b) => {
          if (new TextDecoder().decode(b).includes("7777;hello"))
            card.enqueue(new TextEncoder().encode("\\x1b]7777;mk1;2;0.0.0\\x07\\x1b]7777;f;${CUBE}\\x07"));
        },
      });
    },
    async close() {},
  };
  Object.defineProperty(navigator, "serial", {
    value: { getPorts: async () => [port], requestPort: async () => port, addEventListener() {}, removeEventListener() {} },
  });
}`;

if (only === "levels") {
  for (const theme of ["light", "dark"]) {
    const p = await page({}, { content: fakeCard });
    await p.goto(url(`?theme=${theme}`));
    await card(p);
    await p.getByRole("button", { name: "connect the card" }).click();
    await settle(p, 800);
    await p.locator(".mk1-stage").screenshot({ path: `${out}/${theme}-levels.png` });
    await p.context().close();
  }
  await browser.close();
  console.log("shots in", out);
  process.exit(0);
}

if (only === "nousb") {
  for (const theme of ["light", "dark"]) await noUsb(theme);
  await browser.close();
  console.log("shots in", out);
  process.exit(0);
}

for (const theme of ["light", "dark"]) {
  // nothing connected
  const p = await page();
  await p.goto(url(`?theme=${theme}`));
  await p.evaluate(() => document.fonts.ready);
  await card(p);
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
  await p.locator(".mk1-stage").screenshot({ path: `${out}/${theme}-try-lit.png` });
  await p.keyboard.up(" ");

  // the firmware panel (no release yet: the manifest isn't there and GitHub is stubbed to 404)
  await p.keyboard.press("Control+C");
  await p.getByRole("button", { name: "firmware" }).click();
  await settle(p, 600);
  await p.locator(".mk1-flash").screenshot({ path: `${out}/${theme}-firmware.png` });
  await p.context().close();

  await noUsb(theme);
}

// a phone: an iPhone, where every browser is Safari underneath, without Web Serial and WebUSB
const { defaultBrowserType: _, ...iphone } = devices["iPhone 13"];
const phone = await page({ ...iphone, viewport: { width: 390, height: 844 } }, () => {
  const nav = Object.getPrototypeOf(navigator);
  delete nav.serial;
  delete nav.usb;
});
await phone.goto(url("?theme=light"));
await card(phone);
await settle(phone, 600);
await phone.screenshot({ path: `${out}/phone.png`, fullPage: true });

await browser.close();
console.log("shots in", out);
