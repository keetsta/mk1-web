# mk1-web

фронт keetsta.me/mk1, страницы визитки mk-1: шелл карты в браузере, её прошивка и тот же шелл без карты. React-компонент `<Mk1 />` на стеке сайта (Vite 6, React 19, TS strict), стиль по токенам `keetsta-website`.

- **терминал:** карта по Web Serial (xterm.js). из её потока вынимаются кадры матрицы (OSC 7777, протокол в `shell/SPEC.md`), и превью карты горит кадр в кадр с настоящими светодиодами.
- **прошивка, как у Flipper:** версия на карте рядом с последним релизом и установка в один клик, или свой `.uf2` из файла. карта уходит в загрузчик сама (1200 бод), запись через WebUSB в PICOBOOT. без WebUSB страница ведёт через диск `RP2350`.
- **try it:** настоящий шелл (`shell/`, то же ядро, что в прошивке), собранный в WebAssembly. свет — ползунок, кнопка карты нажимается мышью или пробелом, пищалка звучит.
- **если браузер не может** (Safari, Firefox, телефон, порт занят, нет прав): шаги для терминала на ОС посетителя, `screen`, PuTTY, правило udev.
- **превью** нарисовано из файла платы (`npm run geometry` из `../mk1-card`): контур, шелкография, 144 светодиода на своих местах, кнопка, датчик, USB-C.

```
git submodule update --init   # shell/ = keetsta/mk1-shell
npm install
npm run dev                   # демо-страница
npm run build                 # tsc strict + vite build
npm test                      # node --test: OSC, UF2, PICOBOOT на поддельном загрузчике, шелл в wasm
npm run wasm                  # shell/ -> src/mk1/shell/mk1-shell.wasm (нужен zig: brew install zig или pip install ziglang)
npm run geometry              # ../mk1-card/card.kicad_pcb -> src/mk1/preview/geometry.ts
npm run preview & node tools/shot.mjs shots   # снимки страницы в системном Chrome
```

## в сайт

модуль — это `src/mk1/` (экспорт `Mk1` из `src/mk1/index.ts`). токены и `.card`/`.eyebrow`/`.mono` берёт у сайта; `src/demo/site.css` — их копия только для демо. в сайте: страница `/mk1/` (как `/shop/` у плагина `shopPage`: её `index.html` в `dist/mk1/`), на ней `<Mk1 />`. код можно подключить подмодулем или копией `src/mk1/`; деплою сайта тогда нужен доступ к этому приватному репо (или к копии).

## релизы прошивки

`<Mk1 firmware={{ manifest, github }} />`, по умолчанию `/mk1/firmware/latest.json` и `keetsta/mk1-shell`:

```json
{ "version": "0.2.0", "date": "2026-11-12", "url": "mk1-0.2.0.uf2", "sha256": "…", "page": "https://github.com/keetsta/mk1-shell/releases/tag/v0.2.0" }
```

`url` относительно манифеста. лучше всего, чтобы деплой сайта клал последний релиз рядом (`gh release download --repo keetsta/mk1-shell --pattern '*.uf2'` и `latest.json` с его sha256): тогда страница качает со своего домена. без манифеста она идёт в GitHub Releases напрямую (нужен публичный репо, а GitHub может не отдать файл странице, тогда посетитель получает ссылку на релиз и ставит из файла). пока релизов нет, панель так и говорит.

## что требуется от прошивки карты

- USB CDC под vendor id `0x2e8a` (по нему фильтруется выбор порта);
- протокол страницы из ядра (`shell/SPEC.md`, «протокол страницы»), `shell_disconnect()` при падении DTR;
- открытие порта на 1200 бод перезагружает карту в BOOTSEL.

**проверено только на подделках:** путь Web Serial и запись через PICOBOOT покрыты тестами с поддельным устройством, на живой карте их ещё никто не гонял.
