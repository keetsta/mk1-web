// Screenshots of the demo page in system Chrome: node tools/shot.mjs <out dir> [card|nousb|levels|firefox|silent|busy]
// (needs `npm run preview` on :4173, or SHOT_URL=http://localhost:5173/ for the dev server; `card` takes
// only the card, in both themes; `nousb` only the page as a browser without Web Serial and WebUSB sees it;
// `levels` a card on usb showing a frame of its cube; `firefox` Firefox 151 and newer, Web Serial without WebUSB;
// `silent` a port that never says hello; `busy` a second card while another tab holds the first)
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

// a card on usb showing its own screen: a stand-in port answers the page's hello with one frame of the cube,
// the levels in between that the shell never sends. hello: whether it answers at all; known: the site was
// allowed it before (else the picker, which takes `pick` ms); usb: WebUSB stays; busy: another tab holds the
// known port, and the picker offers a second card. every open's baud rate goes to window.__opens
const CUBE = "00000002410000000000003c79000000000005c66a60000000007b6226b4000000009420034a100000003c6136890000000005b55a8000000000007ab60000000000000440000000";
const fakePort = ({ hello = true, known = true, pick = 0, usb = true, busy = false } = {}) => `{
  window.__opens = [];
  const make = (held) => ({
    getInfo: () => ({ usbVendorId: 0x2e8a }),
    async open(o) {
      if (held) throw new DOMException("Failed to open serial port.", "NetworkError");
      window.__opens.push(o.baudRate);
      let card;
      this.readable = new ReadableStream({ start: (c) => { card = c; } });
      this.writable = new WritableStream({
        write: (b) => {
          if (${hello} && new TextDecoder().decode(b).includes("7777;hello"))
            card.enqueue(new TextEncoder().encode("\\x1b]7777;mk1;2;0.0.0\\x07\\x1b]7777;f;${CUBE}\\x07"));
        },
      });
    },
    async close() {},
  });
  const port = make(${busy});
  const other = ${busy} ? make(false) : port;
  Object.defineProperty(navigator, "serial", {
    value: {
      getPorts: async () => (${known} ? [port] : []),
      requestPort: () => new Promise((done) => setTimeout(() => done(other), ${pick})),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  ${usb ? "" : "delete Object.getPrototypeOf(navigator).usb;"}
}`;

// one block of firmware for the RP2350, enough for the page to take the file
const UF2 = (() => {
  const b = Buffer.alloc(512);
  b.writeUInt32LE(0x0a324655, 0);
  b.writeUInt32LE(0x9e5d5157, 4);
  b.writeUInt32LE(0x2000, 8); // a family id follows
  b.writeUInt32LE(0x10000000, 12);
  b.writeUInt32LE(256, 16);
  b.writeUInt32LE(0xe48bff59, 28); // RP2350, Arm secure
  b.writeUInt32LE(0x0ab16f30, 508);
  return b;
})();
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0";

// Safari (and Firefox before 151) has neither Web Serial nor WebUSB: the page as it meets them, the terminal
// steps after "connect the card", and the firmware panel's way without WebUSB
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

// Firefox 151 and newer: Web Serial behind its permission add-on, no WebUSB. the page while its port list is up
// (the site knows no port yet), then a firmware install, which sends the connected card to its bootloader and
// leaves only the drive
async function firefox(theme) {
  // the list stays up long enough for a full-page shot of the 3D card to land inside it
  const p = await page({ userAgent: FIREFOX }, { content: fakePort({ known: false, pick: 4000, usb: false }) });
  await p.goto(url(`?theme=${theme}`));
  await p.evaluate(() => document.fonts.ready);
  await card(p);
  await p.getByRole("button", { name: "connect the card" }).click();
  await settle(p, 700);
  await p.screenshot({ path: `${out}/${theme}-firefox-pick.png`, fullPage: true });
  await p.getByText(/^firmware \d/).waitFor();
  await p.getByRole("button", { name: "firmware" }).click();
  await settle(p, 600);
  await p.locator(".mk1-drop input[type=file]").setInputFiles({ name: "mk1-test.uf2", mimeType: "application/octet-stream", buffer: UF2 });
  await settle(p, 900);
  await p.locator(".mk1-flash").screenshot({ path: `${out}/${theme}-firefox-flash.png` });
  console.log(`${theme} firefox: the port opened at`, await p.evaluate(() => window.__opens.join(", ")), "baud");
  await p.context().close();
}

// a port that never says hello: another board on Raspberry Pi's vendor id, or a card on other firmware
async function silent(theme) {
  const p = await page({}, { content: fakePort({ hello: false }) });
  await p.goto(url(`?theme=${theme}`));
  await p.evaluate(() => document.fonts.ready);
  await card(p);
  await p.getByRole("button", { name: "connect the card" }).click();
  await settle(p, 2200);
  await p.screenshot({ path: `${out}/${theme}-silent.png`, fullPage: true });
  await p.context().close();
}

// two cards, only the first ever allowed and held by another tab: the help says busy and opens the list, where
// the second is picked
async function busy(theme) {
  const p = await page({}, { content: fakePort({ busy: true }) });
  await p.goto(url(`?theme=${theme}`));
  await p.evaluate(() => document.fonts.ready);
  await card(p);
  await p.getByRole("button", { name: "connect the card" }).click();
  await settle(p, 700);
  await p.locator(".mk1-help").screenshot({ path: `${out}/${theme}-busy.png` });
  await p.getByRole("button", { name: "pick another port" }).click();
  await p.getByText(/^firmware \d/).waitFor();
  await settle(p, 600);
  await p.screenshot({ path: `${out}/${theme}-busy-picked.png`, fullPage: true });
  await p.context().close();
}

const done = async () => {
  await browser.close();
  console.log("shots in", out);
  process.exit(0);
};

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
  await done();
}

if (only === "levels") {
  for (const theme of ["light", "dark"]) {
    const p = await page({}, { content: fakePort() });
    await p.goto(url(`?theme=${theme}`));
    await card(p);
    await p.getByRole("button", { name: "connect the card" }).click();
    await settle(p, 800);
    await p.locator(".mk1-stage").screenshot({ path: `${out}/${theme}-levels.png` });
    await p.context().close();
  }
  await done();
}

const alone = { nousb: noUsb, firefox, silent, busy }[only];
if (alone) {
  for (const theme of ["light", "dark"]) await alone(theme);
  await done();
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
  await firefox(theme);
  await silent(theme);
  await busy(theme);
}

// a phone: an iPhone, where every browser is Safari underneath, without Web Serial and WebUSB. try it leads;
// connect opens the way round, the page sent on to a computer
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
await phone.getByRole("button", { name: "connect the card" }).click();
await settle(phone, 700);
await phone.screenshot({ path: `${out}/phone-help.png`, fullPage: true });

await done();
